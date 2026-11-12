const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

test('audit fixes invalidate old PWA shell and version every changed financial module coherently', () => {
  assert.ok(Number(worker.match(/const CACHE_NAME = "meus-gastos-v(\d+)"/)[1]) >= 35);
  for (const file of ['js/app.js', 'js/domain.js', 'js/document-validator.js']) {
    const source = html.match(new RegExp(`\\./${file.replaceAll('.', '\\.')}\\?v=(\\d+)`));
    assert.ok(source, `missing version: ${file}`);
    assert.ok(Number(source[1]) >= 2026111104, `stale audit module: ${file}`);
    assert.ok(worker.includes(`"${source[0]}"`), `offline version mismatch: ${file}`);
  }
});
