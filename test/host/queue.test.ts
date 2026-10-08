import { describe, expect, it } from 'vitest';
import { SerialQueue } from '../../src/host/queue';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('SerialQueue', () => {
  it('runs an async edit to completion before the undo queued after it', async () => {
    const log: string[] = [];
    const q = new SerialQueue();
    q.push(async () => {
      log.push('edit:start');
      await tick(20);
      log.push('edit:end');
    });
    const last = q.push(() => {
      log.push('undo');
    });
    await last;
    expect(log).toEqual(['edit:start', 'edit:end', 'undo']);
  });

  it('keeps going after a task throws, and reports the error', async () => {
    const errors: unknown[] = [];
    const log: string[] = [];
    const q = new SerialQueue((e) => errors.push(e));
    q.push(() => {
      throw new Error('boom');
    });
    await q.push(() => {
      log.push('next');
    });
    expect(log).toEqual(['next']);
    expect((errors[0] as Error).message).toBe('boom');
  });
});
