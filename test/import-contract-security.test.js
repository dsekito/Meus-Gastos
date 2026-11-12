const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../js/document-validator.js');
require('../js/backup-recovery.js');
const parse = input => MGDocumentValidator.parseImport(input);
const entry = (extra = {}) => ({ id: 'legacy-1', date: '2026-11-11', value: 25, type: 'CASA', description: 'Conta', paid: false, ...extra });
const backup = (entries = [entry()], extra = {}) => ({ schemaVersion: 1, entries, recurrenceSeries: [], settings: {}, ...extra });

test('import IDs cannot escape HTML attributes or selectors; safe legacy IDs are preserved verbatim', () => {
  for (const id of ['audit" data-audit-injected="yes', "x' onclick='x", '<img>', 'x&quote;', 'white space', 'x\\y', 'x[y]', '__proto__', 'constructor', 'prototype', 'x\n', 'x'.repeat(201)]) {
    assert.throws(() => parse([entry({ id })]), /IMPORT_INVALID/, JSON.stringify(id));
  }
  // Existing fixtures use short names, hyphenated IDs and UUIDs, not UUID-only.
  for (const id of ['legacy', 'new', 'entry-1', 'installment-2', '00000000-0000-4000-8000-000000000013', '123', 'legacy_1:2.3']) {
    assert.equal(parse([entry({ id })]).entries[0].id, id);
  }
});

test('renderer-required classification is never invented and invalid paid is never coerced', () => {
  for (const field of ['type', 'description']) {
    const missing=entry(); delete missing[field];
    assert.throws(()=>parse([missing]),/IMPORT_INVALID/,`missing ${field}`);
    for(const value of [null, false, 25, {}, [], '']) assert.throws(()=>parse([entry({[field]:value})]),/IMPORT_INVALID/,field);
  }
  for(const paid of [null, 'false', 0, {}, []]) assert.throws(()=>parse([entry({paid})]),/IMPORT_INVALID/);
});

test('only absent legacy paid is explicitly migrated to pending without mutating input', () => {
  // test/backup-recovery.test.js:5,11-12 represents legacy arrays without paid.
  const legacy={id:'legacy',date:'2026-11-10',value:25,type:'CASA',description:'Conta'};
  for(const input of [[legacy],backup([legacy])]) {
    assert.deepEqual(parse(input).entries,[{...legacy,paid:false}]);
    assert.equal(Object.hasOwn(legacy,'paid'),false);
  }
  assert.deepEqual(parse([entry({paid:true})]).entries,[entry({paid:true})]);
});
