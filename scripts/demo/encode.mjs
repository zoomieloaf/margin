// Turns timestamped PNG frames into a looping GIF: a fixed frame rate, one palette for the whole
// GIF (no dithering), unchanged pixels left transparent so each frame stores only what changed,
// and a short fade from the last frame back to the first so the loop has no jump.
import { writeFileSync } from 'node:fs';
import gifenc from 'gifenc';
import { PNG } from 'pngjs';

const { GIFEncoder, quantize, applyPalette } = gifenc;

/**
 * `frames`: [{ t (ms), png (Buffer) }], in order; the last one marks the end time.
 * Options: `out` (GIF path), `still` (PNG path for the first frame), `width` (downscale to this
 * width when smaller than the frames), `fps`, `fadeMs`.
 */
export async function encodeGif(frames, { out, still, width, fps = 15, fadeMs = 500 }) {
  const step = 1000 / fps;
  const t0 = frames[0].t;
  const end = frames[frames.length - 1].t;

  // Resample to a fixed rate: each tick shows the newest frame at or before it.
  const ticks = [];
  for (let k = 0, i = 0; t0 + k * step < end; k++) {
    const t = t0 + k * step;
    while (i + 1 < frames.length - 1 && frames[i + 1].t <= t) i++;
    if (ticks.at(-1)?.src !== i) ticks.push({ src: i, t: k * step });
  }

  const decoded = new Map();
  const pixels = (i) => {
    if (!decoded.has(i)) {
      const png = PNG.sync.read(frames[i].png);
      decoded.set(i, resize(png.data, png.width, png.height, width));
    }
    return decoded.get(i);
  };

  // Drop frames identical to the one before (their time goes to the previous frame).
  const shots = [];
  for (const tick of ticks) {
    const img = pixels(tick.src);
    if (shots.length && equal(shots.at(-1).img.data, img.data)) continue;
    shots.push({ img, t: tick.t });
  }
  decoded.clear();
  const total = end - t0;

  // The fade back to the first frame, over the last `fadeMs`.
  const first = shots[0].img;
  const last = shots.at(-1).img;
  const fadeSteps = Math.max(0, Math.round(fadeMs / 100));
  for (let s = 1; s <= fadeSteps; s++) {
    shots.push({ img: blend(last, first, s / (fadeSteps + 1)), t: total + (s - 1) * 100 });
  }
  const loopEnd = total + fadeSteps * 100;

  // One palette for every frame: built from the first frame and every pixel that changes later.
  const { w, h } = first;
  const parts = [first.data];
  for (let i = 1; i < shots.length; i++) parts.push(changed(shots[i - 1].img.data, shots[i].img.data));
  const sample = concat(parts, 24e6);
  const palette = quantize(sample, 255, { format: 'rgb565' });
  while (palette.length < 256) palette.push([255, 0, 255]);
  const transparentIndex = 255;

  const gif = GIFEncoder();
  let prev = null;
  let prevCs = 0;
  for (let i = 0; i < shots.length; i++) {
    const index = applyPalette(shots[i].img.data, palette, 'rgb565');
    const nextT = i + 1 < shots.length ? shots[i + 1].t : loopEnd;
    const cs = Math.round(nextT / 10);
    const delay = Math.max(2, cs - prevCs) * 10;
    prevCs = Math.max(prevCs + 2, cs);
    if (!prev) {
      gif.writeFrame(index, w, h, { palette, delay, repeat: 0 });
    } else {
      const diff = new Uint8Array(index.length);
      for (let p = 0; p < index.length; p++) diff[p] = index[p] === prev[p] ? transparentIndex : index[p];
      gif.writeFrame(diff, w, h, { delay, transparent: true, transparentIndex, dispose: 1 });
    }
    prev = index;
  }
  gif.finish();
  const bytes = gif.bytes();
  writeFileSync(out, bytes);

  if (still) {
    const png = new PNG({ width: w, height: h });
    first.data.copy ? first.data.copy(png.data) : png.data.set(first.data);
    writeFileSync(still, PNG.sync.write(png));
  }
  return { out, bytes: bytes.length, width: w, height: h, frames: shots.length, seconds: +(loopEnd / 1000).toFixed(2) };
}

function equal(a, b) {
  return Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0;
}

function changed(a, b) {
  const out = [];
  for (let p = 0; p < a.length; p += 4) {
    if (a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2]) out.push(b[p], b[p + 1], b[p + 2], 255);
  }
  return Uint8Array.from(out);
}

function concat(parts, max) {
  let n = 0;
  for (const p of parts) n += p.length;
  const stride = Math.max(1, Math.ceil(n / max));
  const out = new Uint8Array(Math.ceil(n / stride / 4) * 4 + 4);
  let o = 0;
  let k = 0;
  for (const p of parts) {
    for (let i = 0; i < p.length; i += 4, k++) {
      if (k % stride) continue;
      out[o++] = p[i]; out[o++] = p[i + 1]; out[o++] = p[i + 2]; out[o++] = 255;
    }
  }
  return out.subarray(0, o);
}

function blend(a, b, t) {
  const data = new Uint8Array(a.data.length);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(a.data[i] * (1 - t) + b.data[i] * t);
  return { w: a.w, h: a.h, data };
}

/** Area-average downscale (RGBA) to `width`, keeping the aspect ratio. */
function resize(src, sw, sh, width) {
  if (!width || width >= sw) return { w: sw, h: sh, data: new Uint8Array(src) };
  const dw = width;
  const dh = Math.round((sh * dw) / sw);
  const sx = sw / dw;
  const sy = sh / dh;
  const data = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = y * sy;
    const y1 = y0 + sy;
    for (let x = 0; x < dw; x++) {
      const x0 = x * sx;
      const x1 = x0 + sx;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.min(sh, Math.ceil(y1)); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.min(sw, Math.ceil(x1)); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          const wgt = wx * wy;
          const i = (yy * sw + xx) * 4;
          r += src[i] * wgt; g += src[i + 1] * wgt; b += src[i + 2] * wgt; a += src[i + 3] * wgt;
          wsum += wgt;
        }
      }
      const o = (y * dw + x) * 4;
      data[o] = r / wsum; data[o + 1] = g / wsum; data[o + 2] = b / wsum; data[o + 3] = a / wsum;
    }
  }
  return { w: dw, h: dh, data };
}
