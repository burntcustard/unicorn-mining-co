import assert from 'node:assert/strict';
import { collectorDialog } from '../../src/specs/dialog/collector';
import { pirateDialog } from '../../src/specs/dialog/pirate';
import { jumpGateDialog } from '../../src/specs/dialog/jump-gate';
import type { DialogSpec } from '../../src/specs/dialog/types';

// @ts-expect-error Dialog properties must be arrays rather than single strings.
const singleText: DialogSpec = { greeting: 'Hello' };
// @ts-expect-error Every dialog variant must be a string.
const nonText: DialogSpec = { greeting: [123] };
// @ts-expect-error A dialog needs at least one variant to choose from.
const noVariants: DialogSpec = { greeting: [] };

assert(singleText && nonText && noVariants);

for (const dialog of [collectorDialog, pirateDialog, jumpGateDialog]) {
  for (const lines of Object.values(dialog)) {
    assert(lines.length > 0 && lines.every((line) => typeof line === 'string'));
  }
}
