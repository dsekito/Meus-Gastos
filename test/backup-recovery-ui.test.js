const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
// Recovery is additive and pauses uploads: backup-recovery.test.js and backup-recovery-ui.e2e.cjs.
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('exportação explica arquivo sensível sem criptografia junto ao botão', () => {
  assert.match(html, /<p id="backupPrivacyHelp">[^<]*sem criptografia[^<]*dados financeiros[^<]*<\/p>/i);
  assert.match(html, /id="downloadBackup"[^>]*aria-describedby="backupPrivacyHelp"/);
});

test('oferece importação aditiva com arquivo JSON e explicação sem substituição', () => {
  assert.match(html, /id="importBackupFile"[^>]*accept="[^"]*\.json/);
  assert.match(html, /id="importLocalBackup"/);
  assert.match(html, /sem apagar|não apaga/i);
});

