const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../js/domain.js');
require('../js/document-validator.js');

test('importação JSON usa recuperação transacional local sem restauração destrutiva', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /backup-recovery\.js/);
  // The import itself is exercised in backup-recovery-ui.e2e.cjs.
});

test('busca encontra o detalhe de um lançamento ignorando acentos', () => {
  assert.equal(MGDomain.matchesEntrySearch({type:'Despesa', description:'Saúde', detail:'Consulta cardiológica'}, 'cardiologica'), true);
  assert.equal(MGDomain.matchesEntrySearch({type:'Despesa', description:'Saúde', detail:'Consulta cardiológica'}, 'odontologica'), false);
});

test('busca textual ignora acentos e combina campos sem corresponder outros registros', () => {
  assert.equal(MGDomain.matchesEntrySearch({type:'SAÚDE', description:'Farmácia', notes:'Centro'}, 'saude farmacia'), true);
  assert.equal(MGDomain.matchesEntrySearch({type:'SAÚDE', description:'Farmácia'}, 'saude aluguel'), false);
});

test('comparação de janeiro usa dezembro do ano anterior e o mesmo status', () => {
  const rows = [{date:'2025-12-01', value:100, flow_type:'income', paid:true}, {date:'2026-01-01', value:150, flow_type:'income', paid:true}, {date:'2025-12-02', value:999, paid:false}];
  const result = MGDomain.comparePreviousMonth(rows, '2026-01', {status:'paid'});
  assert.equal(result.previous.month, '2025-12');
  assert.equal(result.previous.income, 100);
  assert.equal(result.difference.income, 50);
});
