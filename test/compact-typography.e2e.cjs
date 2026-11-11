/* Isolated real-Edge visual regression. No external services or real data.
 * Run: node test/compact-typography.e2e.cjs [--baseline]
 * Requires the repository served at http://localhost:8000.
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseline = process.argv.includes('--baseline');
const output = path.join('outputs', 'compact-typography', baseline ? 'before' : 'after');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [], errors = [], consoleErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    // Fulfill optional third-party scripts, preventing network/auth and noisy aborted requests.
    await page.route('https://**/*', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await page.goto('http://localhost:8000');
    await page.evaluate(async () => {
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const id = 'compact-typography-synthetic';
      localStorage.setItem('meus-gastos-google-user', JSON.stringify({ id, email: 'visual@example.invalid', user_metadata: { full_name: 'Perfil visual fictício' } }));
      await MGLocalStore.save(id, { settings: { onboarding_status: 'completed', current_balance: 12345.67, balance_reference_date: date }, entries: [
        { id: '00000000-0000-4000-8000-000000009101', date, type: 'ALIMENTAÇÃO', description: 'SUPERMERCADO', detail: 'Compra fictícia para avaliação de texto comprido e legibilidade', flow_type: 'expense', value: 186.50, paid: false, created_at: `${date}T12:00:00Z`, updated_at: `${date}T12:00:00Z` },
        { id: '00000000-0000-4000-8000-000000009102', date, type: 'A RECEBER', description: 'ENTRADA FICTÍCIA', flow_type: 'income', value: 1500, paid: false, created_at: `${date}T12:00:00Z`, updated_at: `${date}T12:00:00Z` }
      ] });
    });
    await page.reload();
    await page.waitForSelector('#appShell:not([hidden])');
    const nav = view => page.locator(`.app-navigation [data-app-destination="${view}"]`);
    async function inspect(name, root = '#appShell') {
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
      await page.screenshot({ path: path.join(output, `${name}-viewport.png`) });
      const report = await page.locator(root).evaluate(root => {
        const visible = e => e.checkVisibility() && getComputedStyle(e).visibility !== 'hidden';
        const font = s => [...root.querySelectorAll(s)].filter(visible).map(e => ({ text: e.textContent.trim().slice(0,60), size: parseFloat(getComputedStyle(e).fontSize) }));
        const smallTargets = [...root.querySelectorAll('button,input:not([type=checkbox]),select,summary')].filter(visible).filter(e => { const r = e.getBoundingClientRect(); return r.width < 47.9 || r.height < 47.9; }).map(e => e.id || e.textContent.trim());
        const clipped = [...root.querySelectorAll('.amount,.view-heading h2,.card-note,.upcoming-item span,.entry-title-text,.entry-type')].filter(visible).filter(e => e.scrollWidth > e.clientWidth + 1 && ['hidden','clip'].includes(getComputedStyle(e).overflowX)).map(e => e.className);
        const controlOverflow = [...root.querySelectorAll('button,summary')].filter(visible).filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.id || e.textContent.trim());
        const squeezedLabels = [...root.querySelectorAll('.upcoming-item > span')].filter(visible).filter(e => e.getBoundingClientRect().width < 150).map(e => e.textContent.trim());
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1, smallTargets, clipped, controlOverflow, squeezedLabels,
          headings: font('.view-heading h2'), balance: font('.balance-card .amount'), secondary: font('.decision-card .amount,.minimum-card .amount,.monthly-total strong,.projection-month-summary strong'),
          body: font('.upcoming-item span,.entry-title-text,.entry-value,.card .label'), auxiliary: font('.decision-cards .card-note,.entry-meta-line'), inputs: font('input,select,textarea'),
          margin: parseFloat(getComputedStyle(document.querySelector('.shell')).paddingLeft) };
      });
      results.push({ name, ...report });
    }
    for (const width of [320, 375, 1280]) {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 812 });
      for (const view of ['home','records','projection','monthly','settings']) {
        await nav(view).click();
        await inspect(`${view}-${width}`);
      }
      await nav('home').click();
      await page.locator('#openModalMobile').click();
      await inspect(`entry-${width}`, '#entryDialog');
      await page.locator('#entryDialog [data-close]').first().click();
    }
    // Reflow proxy for 200% desktop zoom: half the original CSS viewport.
    await page.setViewportSize({ width: 640, height: 450 });
    await nav('home').click();
    await inspect('home-200percent-reflow');
    await page.setViewportSize({ width: 320, height: 812 });
    // Text-only zoom simulation doubles computed sizes, not inherited percentages.
    await page.reload();
    await page.waitForSelector('#appShell:not([hidden])');
    await page.evaluate(() => { const entries = [...document.querySelectorAll('body *')].map(e => [e, getComputedStyle(e).fontSize]); for (const [e,size] of entries) e.style.setProperty('font-size', `${parseFloat(size)*2}px`, 'important'); });
    await inspect('home-text-200percent-320');
    fs.writeFileSync(path.join(output, 'metrics.json'), JSON.stringify({ results, errors, consoleErrors }, null, 2));
    const violations = [];
    for (const r of results) {
      if (r.overflow || r.smallTargets.length || r.clipped.length || r.controlOverflow.length || r.squeezedLabels.length || r.margin < 16) violations.push({ name: r.name, geometry: { overflow: r.overflow, smallTargets: r.smallTargets, clipped: r.clipped, controlOverflow: r.controlOverflow, squeezedLabels:r.squeezedLabels, margin: r.margin } });
      if (r.name.includes('percent')) continue;
      for (const [group,min,max] of [['headings',20,22],['balance',26,30],['secondary',18,20],['body',16,16],['auxiliary',14,14],['inputs',16,16]]) {
        for (const f of r[group]) if (f.size < min || f.size > max) violations.push({ name:r.name, group, ...f, expected:`${min}–${max}px` });
      }
    }
    fs.writeFileSync(path.join(output, 'violations.json'), JSON.stringify(violations, null, 2));
    assert.deepEqual(errors, [], 'No uncaught JS errors');
    assert.deepEqual(consoleErrors, [], 'No console errors');
    assert.deepEqual(violations, [], 'Compact typography, wrapping, 48px targets, 16px margins and 200% reflow');
    console.log(`PASS: ${results.length} real Edge scenarios (${results.length * 2} screenshots); compact typography, responsive geometry, 200% text/reflow simulation; console clean. Artifacts: ${output}`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
