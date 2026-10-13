import type { TestEvent } from 'node:test/reporters';

/*
 * Report execution events immediately while spec output waits for file order.
 */
export default async function* testProgress(source: AsyncIterable<TestEvent>) {
  for await (const event of source) {
    if (event.type === 'test:dequeue' && event.data.nesting === 0) {
      yield `[start] ${event.data.name}\n`;
    } else if (event.type === 'test:complete' && event.data.nesting === 0) {
      const { name, details } = event.data;

      yield `[${details.passed ? 'pass' : 'fail'}] ${name} (${(details.duration_ms / 1000).toFixed(2)}s)\n`;
    }
  }
}
