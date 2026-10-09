// Writes THIRD-PARTY-NOTICES.txt: the license of every npm package esbuild bundled into dist/,
// plus the icon set the toolbar icons are drawn after. MIT and ISC ask for their notice to travel
// with every copy, and minifying strips it from the bundles, so the .vsix ships this file instead.
import fs from 'node:fs';
import path from 'node:path';

/** Icons in src/webview/ui/icons.ts follow Lucide's paths (ISC; parts from Feather, MIT). */
const LUCIDE = `ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without
fee is hereby granted, provided that the above copyright notice and this permission notice appear
in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE
OF THIS SOFTWARE.`;

/** The MIT text, for a package that declares MIT but ships no license file. */
const mitText = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const PERMISSIVE = /^(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD)$/;

/** The bundled packages, from esbuild metafiles: name → { version, license, text }. */
export function bundledPackages(metafiles) {
  const pkgs = new Map();
  for (const meta of metafiles) {
    for (const input of Object.keys(meta.inputs)) {
      const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(input.split(path.sep).join('/'));
      if (!m || pkgs.has(m[1])) continue;
      const dir = path.join('node_modules', m[1]);
      const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const license = typeof pj.license === 'string' ? pj.license : (pj.licenses?.[0]?.type ?? pj.license?.type ?? 'UNKNOWN');
      const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
      const author = typeof pj.author === 'string' ? pj.author : pj.author?.name;
      const text = file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : license === 'MIT' ? mitText(author ?? `the ${m[1]} authors`) : '';
      pkgs.set(m[1], { version: pj.version, license, text });
    }
  }
  return pkgs;
}

/** Writes the notices file; throws on a package whose license isn't a known permissive one. */
export function writeNotices(metafiles, out = 'THIRD-PARTY-NOTICES.txt') {
  const pkgs = [...bundledPackages(metafiles)].sort(([a], [b]) => a.localeCompare(b));
  const odd = pkgs.filter(([, p]) => !PERMISSIVE.test(p.license) || !p.text).map(([n, p]) => `${n} (${p.license})`);
  if (odd.length) throw new Error(`Check these licenses before shipping: ${odd.join(', ')}`);
  const parts = [
    'Margin includes the following third-party software. Each is used under the license shown.',
    `lucide (toolbar icon drawings, src/webview/ui/icons.ts)\n\n${LUCIDE}`,
    ...pkgs.map(([n, p]) => `${n}@${p.version} (${p.license})\n\n${p.text}`),
  ];
  fs.writeFileSync(out, parts.join(`\n\n${'-'.repeat(80)}\n\n`) + '\n');
  return pkgs.length;
}
