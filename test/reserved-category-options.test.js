const assert = require('node:assert/strict');
const { test } = require('node:test');
global.window = global;
require('../js/domain.js');
const { descriptionOptionsForType } = global.MGDomain;

for (const category of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
  for (const field of ['defaultOptions', 'customOptions', 'hiddenOptions']) {
    test(`${category}: ${field} ignores non-array lookup values without losing selected/history descriptions`, () => {
      const values = [Object.prototype[category], null, 'NOT AN ARRAY', { invalid: true }, 42];
      for (const value of values) {
        assert.deepEqual(descriptionOptionsForType({
          selectedType: category, selectedDescription: 'Selected',
          entries: [{ type: category, description: 'History' }, { type: 'Other', description: 'Unrelated' }],
          [field]: value,
        }), ['History', 'Selected']);
      }
    });
  }
}

test('valid arrays retain defaults, custom choices and selected hidden descriptions for reserved categories', () => {
  assert.deepEqual(descriptionOptionsForType({
    selectedType: '__proto__', selectedDescription: 'Selected',
    entries: [{ type: '__proto__', description: 'History' }],
    defaultOptions: ['Default', 'Hidden'], customOptions: ['Custom', 'Default'],
    hiddenOptions: ['Hidden', 'Selected'],
  }), ['Default', 'Custom', 'History', 'Selected']);
});
