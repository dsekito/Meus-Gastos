const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'mobile.css'), 'utf8');

test('explica a dependência junto ao tipo e associa a explicação à descrição', () => {
  assert.match(html, /id="description"[^>]*aria-describedby="descriptionHelp"/);
  assert.match(html, /id="descriptionHelp"[^>]*>A descrição depende do tipo\./);
});

test('ações móveis preservam botões e contratos da camada visual compartilhada', () => {
  const form = html.match(/<form\b[^>]*\bid="entryForm"[^>]*>[\s\S]*?<\/form>/)?.[0] || '';
  assert.match(form, /id="saveEntry"/);
  assert.match(form, /data-close/);
  assert.match(css, /\.modal-foot/);
  assert.match(css, /\.mobile-new-entry/);
  assert.match(css, /min-height:\s*48px/);
  // Computed48px targets, compact two-action row and non-floating CTA are
  // verified in space-efficient-redesign.e2e.cjs, not by CSS-selector spelling.
});

