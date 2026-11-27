import { finishBuffer } from './synthesis';

type BufferContext = Pick<BaseAudioContext, 'createBuffer'>;

export type BufferPreparation = {
  render: (context: BufferContext) => Generator<void, AudioBuffer>;
  buffer?: AudioBuffer;
  ready?: (buffer: AudioBuffer) => void;
  pending?: Generator<void, AudioBuffer>;
  urgent?: boolean;
};

const queue: BufferPreparation[] = [];

const schedule = () => {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(prepareSlice, { timeout: 32 });
  } else {
    setTimeout(prepareSlice, 8);
  }
};

function prepareSlice(deadline?: IdleDeadline) {
  const entry = queue.find(({ urgent }) => urgent) ?? queue[0];

  if (!entry) return;
  const budget =
    !deadline || deadline.didTimeout
      ? 1
      : Math.min(1.5, deadline.timeRemaining() - 0.5);

  if (budget <= 0 && !entry.urgent) {
    schedule();
    return;
  }

  let buffer: AudioBuffer | undefined;

  try {
    const render = entry.pending!;
    const until = performance.now() + budget;
    let step = render.next();

    while (!step.done && performance.now() < until) step = render.next();

    if (!step.done) {
      schedule();
      return;
    }

    buffer = step.value;
  } catch {
    // A failed render can be retried by a subsequent request.
  }

  const ready = entry.ready;

  queue.splice(queue.indexOf(entry), 1);
  entry.pending = undefined;
  entry.urgent = false;
  entry.ready = undefined;

  if (queue.length) schedule();

  if (buffer) {
    entry.buffer = buffer;
    ready?.(buffer);
  }
}

export function prepareBuffer(
  entry: BufferPreparation,
  context: BufferContext,
  urgent = true,
) {
  if (entry.buffer) return entry.buffer;

  // Non-browser audio tools can take an immediate result.
  if (typeof document === 'undefined') {
    return (entry.buffer = finishBuffer(entry.render(context)));
  }

  entry.urgent ||= urgent;

  if (entry.pending) return;

  entry.pending = entry.render(context);
  queue.push(entry);

  if (queue.length === 1) schedule();
}
