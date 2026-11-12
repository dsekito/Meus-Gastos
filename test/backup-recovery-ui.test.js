const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

test('exportação explica arquivo sensível sem criptografia junto ao botão', () => {
  assert.match(html, /<p id="backupPrivacyHelp">[^<]*sem criptografia[^<]*dados financeiros[^<]*<\/p>/i);
  assert.match(html, /id="downloadBackup"[^>]*aria-describedby="backupPrivacyHelp"/);
});

test('oferece importação aditiva com arquivo JSON e explicação sem substituição', () => {
  assert.match(html, /id="importBackupFile"[^>]*accept="[^"]*\.json/);
  assert.match(html, /id="importLocalBackup"/);
  assert.match(html, /sem apagar|não apaga/i);
});

test('recuperação do Drive não apaga lançamentos ausentes no backup', () => {
  const recovery = app.slice(app.indexOf('async function restoreGoogleDriveBackup()'), app.indexOf('async function addOption('));
  assert.doesNotMatch(recovery, /queueDelete\(/);
  assert.doesNotMatch(recovery, /state\.entries = structuredClone\(backup\.entries\)/);
  assert.doesNotMatch(recovery, /atuais serão substituídos/);
  assert.match(recovery, /recoverBackupAdditively/);
});
