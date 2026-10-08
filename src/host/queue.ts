/**
 * Runs tasks one at a time, in the order they were pushed. The webview's messages go through
 * one of these per editor so an `edit` is fully applied before a following `undo` runs.
 * A task that throws is reported and doesn't stop the tasks after it.
 */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly onError: (err: unknown) => void = (err) => console.error('[margin]', err)) {}

  /** Queues `task`; the returned promise settles when it has run. */
  push(task: () => unknown): Promise<void> {
    this.tail = this.tail.then(task).then(
      () => undefined,
      (err: unknown) => this.onError(err),
    );
    return this.tail;
  }
}
