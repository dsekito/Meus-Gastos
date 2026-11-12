// All-surface visual contract. Synthetic data only; no authenticated user profile or external writes.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto'), assert = require('assert/strict');
const repo = path.resolve(__dirname, '..');
const phase = process.env.VISUAL_PHASE || 'after';
const base = path.join(repo, 'outputs/space-efficient-redesign');
const root = phase === 'before' ? path.join(base, 'baseline-src') : repo;
const out = path.join(base, phase); fs.mkdirSync(out, { recursive: true });
const scope = JSON.parse(fs.readFileSync(path.join(base, 'scope.json'), 'utf8'));
const sourceHashes = () => Object.fromEntries(['index.html','mobile.css','js/app.js','js/domain.js','js/document-validator.js'].map(file => [file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
const result = { phase, fixtures: 'synthetic November 11 2026, Edge isolated contexts, external requests aborted', sourceHashesBefore:sourceHashes(), observations: [], errors: [], blocked: [], failures: [] };
const user = { id: 'visual-refresh-synthetic', email: 'visual@example.invalid' };
const entries = [];
for (let month = 1; month <= 12; month++) {
  const m = String(month).padStart(2, '0');
  entries.push({ id: `visual-income-${m}`, date: `2026-${m}-05`, value: 6850.25, type: 'A RECEBER', description: 'SALÁRIO', flow_type: 'income', paid: month < 11, created_at: `2026-${m}-01T12:00:00Z` });
  entries.push({ id: `visual-rent-${m}`, date: `2026-${m}-10`, value: 1480, type: 'MORADIA', description: 'ALUGUEL', detail: 'Moradia', flow_type: 'expense', paid: month < 11, created_at: `2026-${m}-02T12:00:00Z` });
  entries.push({ id: `visual-food-${m}`, date: `2026-${m}-14`, value: 327.65, type: 'ALIMENTAÇÃO', description: 'SUPERMERCADO', detail: 'Compras da semana', flow_type: 'expense', paid: month < 11, created_at: `2026-${m}-03T12:00:00Z` });
}
entries.push({ id: 'visual-energy', date: '2026-11-12', value: 178.9, type: 'MORADIA', description: 'ENERGIA', flow_type: 'expense', paid: false, created_at: '2026-11-08T12:00:00Z' });
entries.push({ id: 'visual-long', date: '2026-11-15', value: 1234567.89, type: 'OUTROS', description: 'SERVIÇOS PROFISSIONAIS', detail: 'Assinatura de ferramentas e serviços profissionais com descrição longa', flow_type: 'expense', paid: false, created_at: '2026-11-09T12:00:00Z' });
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/seed') return res.end('<!doctype html><title>Synthetic visual fixtures</title>');
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (e, body) => {
    if (e) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' })[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  });
});
const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
function expect(condition, message) { if (!condition) result.failures.push(message); }
async function capture(page, name, width) {
  if (scope.dialogs.includes(name)) await page.waitForSelector(`#${name}[open]`, { state: 'visible' });
  const metrics = await page.evaluate(() => {
    const rect = e => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
    const visible = e => e.checkVisibility();
    const money = [...document.querySelectorAll('.amount,.entry-value,.monthly-total strong,.monthly-cash-flow-card dd')].filter(visible);
    const small = [...document.querySelectorAll('button,summary,input:not([type="checkbox"]),select,textarea')].filter(visible).filter(e => { const r = e.getBoundingClientRect(); return r.width < 47.9 || r.height < 47.9; }).map(e => ({ id: e.id, text: e.innerText?.slice(0, 50), rect: rect(e) }));
    return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight,
      overflow: document.documentElement.scrollWidth > innerWidth + 1, bodyFont: getComputedStyle(document.body).fontSize,
      shell: rect(document.querySelector('#appShell')), overview: rect(document.querySelector('.decision-overview')), decisionCards: rect(document.querySelector('.decision-cards')),
      monthCards: [...document.querySelectorAll('.monthly-cash-flow-card')].filter(visible).slice(0, 2).map(rect),
      rows: [...document.querySelectorAll('#rows .dense-entry')].filter(visible).map(rect), small,
      clippedMoney: money.filter(e => e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).textOverflow === 'ellipsis').map(e => ({ text: e.textContent, rect: rect(e) })),
      openDialogs: [...document.querySelectorAll('dialog[open]')].map(e => ({ id: e.id, rect: rect(e), scrollHeight: e.scrollHeight, clientHeight: e.clientHeight })),
      saveAction: rect(document.querySelector('#entryDialog[open] #saveEntry')),
      newEntryPosition: getComputedStyle(document.querySelector('#openModalMobile')).position,
      cancelAction: rect(document.querySelector('#entryDialog[open] .modal-foot [data-close]')),
      financialText: document.querySelector('[data-app-panel="home"]')?.innerText.slice(0, 1000)
    };
  });
  const file = `${name}-${width}.png`;
  await page.screenshot({ path: path.join(out, file), fullPage: false });
  result.observations.push({ name, width, screenshot: file, ...metrics }); save();
  expect(!metrics.overflow, `${name}@${width}: document overflow`);
  expect(Number.parseFloat(metrics.bodyFont) >= 16, `${name}@${width}: body below16px`);
  // Sparse close icons/legacy checkbox targets are reported for review; hard assertions cover primary controls separately.
  expect(!metrics.clippedMoney.length, `${name}@${width}: clipped financial amount`);
  if (['home', 'records'].includes(name)) expect(!['fixed','absolute'].includes(metrics.newEntryPosition), `${name}@${width}: new-entry action must not float over content`);
  if (name === 'entryDialog' && width <= 375) {
    const a = metrics.saveAction, b = metrics.cancelAction;
    expect(a && b && a.width >= 48 && a.height >= 48 && b.width >= 48 && b.height >= 48, `${name}@${width}: main form actions require48px targets`);
    expect(a && b && Math.abs(a.y - b.y) < 2, `${name}@${width}: main form actions should share a compact row`);
  }
  return metrics;
}
async function contextFor(browser, origin, width, signedIn = true) {
  const context = await browser.newContext({ viewport: { width, height: width === 1366 ? 900 : width === 844 ? 390 : 812 }, timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block' });
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); result.blocked.push(route.request().url()); return route.abort(); });
  const page = await context.newPage(); page.on('pageerror', e => { result.errors.push(e.message); save(); });
  await page.clock.install({ time: new Date('2026-11-11T15:00:00Z') });
  if (signedIn) {
    await page.goto(origin + '/seed'); await page.addScriptTag({ url: origin + '/js/local-store.js' });
    await page.evaluate(async ({ user, entries }) => {
      localStorage.setItem('meus-gastos-google-user', JSON.stringify(user));
      await MGLocalStore.save(user.id, { settings: { current_balance: 4700, balance_reference_date: '2026-11-01', onboarding_status: 'completed' }, entries, syncQueue: [], recurrenceSeries: [] });
    }, { user, entries });
  }
  await page.goto(origin); await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
  return { context, page };
}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [320, 375, 768, 1366, 844]) {
      const { context, page } = await contextFor(browser, origin, width);
      const financialBefore = await page.evaluate(() => JSON.stringify([state.entries, state.settings, state.syncQueue, state.recurrenceSeries]));
      const nav = async view => { await page.locator(`.app-navigation [data-app-destination="${view}"]`).click(); await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); };
      for (const view of scope.views) {
        await nav(view); const m = await capture(page, view, width);
        // A conditional negative-balance warning belongs in the overview, but must
        // not count against the compactness budget for the cards themselves.
        if (view === 'home' && width === 375) expect(m.decisionCards.height <= 335, 'home@375: decision cards must be compact, <=335px');
        if (view === 'monthly' && width === 375) expect(m.monthCards.every(c => c.height <= 260), 'monthly@375: month cards must be <=260px');
        if (view === 'monthly' && width === 1366) expect(m.monthCards.length === 2 && Math.abs(m.monthCards[0].y - m.monthCards[1].y) < 2, 'monthly desktop: use multiple aligned columns');
        if (view === 'records' && width === 1366) expect(m.shell.width >= width * .94, 'desktop: workspace must use available width');
      }
      if ([320, 375, 1366].includes(width)) {
        const close = async () => { await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close())); };
        await nav('records');
        await page.locator('.filter-disclosure > summary').click(); await capture(page, 'records-filters', width);
        await page.locator('#filterSearch').fill('BUSCA SEM RESULTADO SINTÉTICO'); await capture(page, 'records-empty-search', width);
        await page.locator('#clearEntryFilters').click();
        await page.evaluate(() => { document.querySelector('.filter-disclosure').open = false; });
        await page.locator('#filterMonth').fill('2028-01'); await page.locator('#filterMonth').dispatchEvent('change'); await capture(page, 'records-empty-month', width);
        await page.locator('#goToCurrentMonth').click();
        await page.locator('#openModalMobile').click(); await capture(page, 'entryDialog', width);
        await page.locator('#entryAdvanced > summary').click(); await page.locator('#recurrence').selectOption('installments'); await capture(page, 'entry-installments', width);
        await page.locator('#recurrence').selectOption('monthly'); await capture(page, 'entry-recurring', width); await close();
        for (const topic of scope.settings_topics) {
          await nav('settings'); await page.locator(`[data-settings-topic="${topic}"]`).click(); await capture(page, `settingsDialog-${topic}`, width);
          if (topic === 'options') { await page.locator('[data-add-option="types"]').click(); await capture(page, 'optionDialog', width); }
          await close();
        }
        await nav('records'); await page.evaluate(() => openRecentRecordsDialog()); await capture(page, 'recentRecordsDialog', width); await close();
        await page.evaluate(() => openRecordsManagerDialog()); await capture(page, 'recordsManagerDialog', width);
        await page.locator('#recordsManagerDialog .manager-filters > summary').click(); await capture(page, 'recordsManager-filters', width); await close();
        await page.evaluate(() => { renderOnboardingCategories(); document.querySelector('#onboardingBalance').value = '4700'; document.querySelector('#onboardingReferenceDate').value = '2026-11-11'; onboardingDialog.showModal(); }); await capture(page, 'onboardingDialog', width); await close();
        for (const id of ['seriesScopeDialog', 'bulkDateDialog', 'syncConflictDialog', 'deleteConfirmDialog']) {
          await page.evaluate(id => document.getElementById(id).showModal(), id); await capture(page, id, width); await close();
        }
        await page.evaluate(() => setSyncStatus('conflict', 'Conflito de sincronização')); await capture(page, 'sync-error', width);
        await page.evaluate(() => setSyncStatus('syncing', 'Sincronizando alterações...')); await capture(page, 'sync-loading', width);
        await page.evaluate(() => setSyncStatus('idle', 'Modo local'));
      }
      if (width === 844) {
        await nav('records'); await page.locator('#openModalMobile').click();
        await page.locator('#entryAdvanced > summary').click();
        await page.locator('#saveEntry').scrollIntoViewIfNeeded();
        const landscape = await capture(page, 'entry-landscape-actions', width);
        expect(landscape.saveAction && landscape.saveAction.y >= 0 && landscape.saveAction.bottom <= landscape.viewport.height + 1, 'Landscape form save action must be reachable');
        await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
      }
      const financialAfter = await page.evaluate(() => JSON.stringify([state.entries, state.settings, state.syncQueue, state.recurrenceSeries]));
      expect(financialBefore === financialAfter, `visual inspection changed financial state at${width}`);
      await context.close();
    }
    {
      const { context, page } = await contextFor(browser, origin, 375);
      await page.evaluate(() => {
        const originalBody = document.body.style.fontSize;
        let prior = [];
        window.__visualText200 = () => {
          prior.forEach(([e, original]) => e.style.fontSize = original);
          document.body.style.fontSize = originalBody;
          const text = [...document.querySelectorAll('body *')].filter(e => ['BUTTON','INPUT','SELECT','TEXTAREA','SUMMARY'].includes(e.tagName) || [...e.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()));
          const sizes = text.map(e => [e, Number.parseFloat(getComputedStyle(e).fontSize)]);
          prior = text.map(e => [e, e.style.fontSize]);
          document.body.style.fontSize = '32px';
          sizes.forEach(([e, size]) => e.style.fontSize = `${size * 2}px`);
        };
        window.__visualText200();
      });
      await capture(page, 'home-text-200pct', 375);
      await page.locator('.app-navigation [data-app-destination="records"]').click(); await page.evaluate(() => window.__visualText200()); await capture(page, 'records-text-200pct', 375);
      await page.locator('#openModalMobile').click(); await page.evaluate(() => window.__visualText200()); await page.locator('#saveEntry').scrollIntoViewIfNeeded();
      const large = await capture(page, 'entry-text-200pct', 375);
      expect(large.saveAction && large.saveAction.bottom <= large.viewport.height + 1, 'Enlarged-text save action must be reachable');
      await context.close();
    }
    for (const width of [320, 375, 1366]) {
      const { context, page } = await contextFor(browser, origin, width, false); await capture(page, 'authScreen', width); await context.close();
      const c = await browser.newContext({ viewport: { width, height: width === 1366 ? 900 : 812 }, serviceWorkers: 'block' });
      await c.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin !== origin) return route.abort(); if (url.pathname === '/js/app.js') return route.fulfill({ contentType: 'application/javascript', body: '/* actual bootstrap markup shown while app execution is held */' }); return route.continue(); });
      const p = await c.newPage(); await p.goto(origin); await capture(p, 'bootstrapScreen', width); await c.close();
    }
    const observedDialogs = new Set(result.observations.flatMap(o => o.openDialogs.map(d => d.id)));
    expect(scope.dialogs.every(d => observedDialogs.has(d)), 'Missing dialog coverage: ' + scope.dialogs.filter(d => !observedDialogs.has(d)).join(','));
    expect(scope.views.every(v => result.observations.some(o => o.name === v)), 'Missing view coverage');
    expect(!result.errors.length, 'Uncaught browser errors: ' + result.errors.join(';'));
    result.sourceHashesAfter = sourceHashes();
    result.sourceStable = JSON.stringify(result.sourceHashesBefore) === JSON.stringify(result.sourceHashesAfter);
    expect(result.sourceStable, 'Source changed while capturing visual evidence; rerun before final acceptance');
    result.coverage = { views: scope.views.length, dialogs: observedDialogs.size, observations: result.observations.length, screenshots: new Set(result.observations.map(o => o.screenshot)).size }; save();
    console.log(JSON.stringify({ phase, coverage: result.coverage, failures: result.failures }, null, 2));
    if (result.failures.length) process.exitCode = 1;
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { result.fatal = e.stack; save(); console.error(e); process.exitCode = 1; });
