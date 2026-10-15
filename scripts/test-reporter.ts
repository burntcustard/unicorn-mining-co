import { Readable } from 'node:stream';
import { resolve } from 'node:path';
import { spec, type TestEvent } from 'node:test/reporters';

/*
 * Keep successful tests quiet, but replay captured output when a test fails.
 */
async function* filterOutput(source: AsyncIterable<TestEvent>) {
  const output = new Map<string, TestEvent[]>();

  for await (const event of source) {
    if (event.type === 'test:stdout' || event.type === 'test:stderr') {
      const file = resolve(event.data.file);
      const events = output.get(file) ?? [];

      events.push(event);
      output.set(file, events);
      continue;
    }

    if (event.type === 'test:fail') {
      const file = resolve(event.data.file);

      yield* output.get(file) ?? [];
      output.delete(file);
    } else if (event.type === 'test:pass' && event.data.nesting === 0) {
      output.delete(resolve(event.data.file));
    }

    yield event;
  }
}

export default async function* testReporter(source: AsyncIterable<TestEvent>) {
  const report = Readable.from(filterOutput(source)).pipe(new spec());

  for await (const chunk of report) {
    yield String(chunk)
      .replace(
        /\((\d+(?:\.\d+)?)ms\)/g,
        (_, duration) => `(${Math.round(Number(duration))}ms)`,
      )
      .replace(
        /(\bduration_ms )(\d+(?:\.\d+)?)/g,
        (_, label, duration) => label + Math.round(Number(duration)),
      );
  }
}
