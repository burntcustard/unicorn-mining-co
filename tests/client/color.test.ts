import assert from 'node:assert/strict';
import { withAlpha } from '../../src/client/utilities/color';

assert.equal(withAlpha({ color: '#e6f' }), '#e6f');
assert.equal(withAlpha({ color: '#e6f', alpha: 1 }), '#e6f');
assert.equal(withAlpha({ color: '#e6f', alpha: 0 }), '#ee66ff00');
assert.equal(withAlpha({ color: '#e6f', alpha: 0.4 }), '#ee66ff66');
assert.equal(withAlpha({ color: '#e6f', alpha: 0.5 }), '#ee66ff80');
assert.equal(withAlpha({ color: '#e6f', alpha: 4 / 15 }), '#ee66ff44');
assert.equal(withAlpha({ color: '#ee66ff', alpha: 0.4 }), '#ee66ff66');
assert.equal(withAlpha({ color: '#E6F', alpha: 0.2 }), '#EE66FF33');

console.log('Numeric colour alpha preserves palette colours and hex opacity');
