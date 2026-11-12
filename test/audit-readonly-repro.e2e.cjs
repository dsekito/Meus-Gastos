// READ-ONLY audit: own synthetic contexts, no real profile/auth/network.
// Run: node test/audit-readonly-repro.e2e.cjs
// Regression suite: each scenario once reproduced a defect; assertions now
// describe the correct behavior (rollback on failed writes, no duplicates,
// detached recurrence exceptions keep their slot).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const user = { id: 'readonly-audit-synthetic', email: 'audit@example.invalid' };
const id = '00000000-0000-4000-8000-000000000091';
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/seed') return res.end('<!doctype html><title>Synthetic audit</title>');
  if (pathname === '/js/google-auth.js') {
    res.setHeader('Content-Type', 'application/javascript');
    return res.end(`window.MGGoogleAuth={create:()=>({restoreSession:()=>JSON.parse(localStorage.getItem('meus-gastos-google-user')||'null'),hasAccessToken:()=>false,getAccessToken:()=>null,isAccessTokenExpired:()=>false,clearToken:()=>{},signOut:async()=>{},signIn:async()=>{throw Error('REAL_AUTH_FORBIDDEN')}})};`);
  }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (error, body) => {
    if (error) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', ({ '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  });
});
async function abortNextPut(page) {
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      const request = put.apply(this, args);
      this.transaction.abort();
      IDBObjectStore.prototype.put = put;
      return request;
    };
  });
}
async function snapshot(page) {
  return page.evaluate(async user => ({ entries: structuredClone(state.entries), settings: structuredClone(state.settings), queue: structuredClone(state.syncQueue),
    persisted: await MGLocalStore.load(user.id, { observe: false }), toast: document.querySelector('#toast').textContent }), user);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [];
  try {
    for (const scenario of ['create-abort-retry', 'delete-abort', 'settings-abort', 'delete-cas', 'recurrence-detached', 'installments-paid', 'mixed-period-empty']) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, timezoneId: 'America/Sao_Paulo' });
      await context.addInitScript(() => {
        const OriginalDate = Date;
        window.Date = class extends OriginalDate {
          constructor(...args) { super(...(args.length ? args : ['2026-11-11T15:00:00Z'])); }
          static now() { return new OriginalDate('2026-11-11T15:00:00Z').getTime(); }
        };
      });
      const errors = [], remote = [];
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin === origin) return route.continue();
        remote.push(route.request().url());
        return route.fulfill({ contentType: 'application/javascript', body: '/* blocked */' });
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      try {
        await page.goto(origin + '/seed');
        await page.addScriptTag({ url: origin + '/js/local-store.js' });
        await page.evaluate(async ({user,id}) => {
          localStorage.setItem('meus-gastos-google-user', JSON.stringify(user));
          await MGLocalStore.save(user.id, { entries: [{ id, date: '2026-11-10', value: 200, type: 'OUTROS', description: 'OUTROS', paid: false, flow_type: 'expense', detail: 'synthetic', updated_at: '2026-11-01T12:00:00Z' }],
            settings: { onboarding_status: 'completed', current_balance: 1000, balance_reference_date: '2026-11-01' }, syncQueue: [] });
        }, {user,id});
        await page.goto(origin);
        await page.waitForFunction(() => typeof state !== 'undefined' && state.entries.length === 1 && document.body.getAttribute('aria-busy') === 'false');
        const before = await snapshot(page);
        let result;
        if (scenario === 'create-abort-retry') {
          await page.evaluate(() => { openNew(); dateInput.value='2026-11-11'; valueInput.value='50'; flowType.value='expense'; type.value='OUTROS'; renderEntryOptions('OUTROS','OUTROS'); recurrence.value='single'; updateEntryFormVisibility(); });
          await abortNextPut(page);
          await page.locator('#saveEntry').click();
          await page.waitForTimeout(100);
          const failed = await snapshot(page);
          assert.equal(failed.entries.length, 1, 'failed create must not stay in memory');
          assert.equal(failed.persisted.entries.length, 1);
          await page.locator('#saveEntry').click();
          await page.waitForFunction(() => !document.querySelector('#entryDialog').open);
          const retry = await snapshot(page);
          assert.equal(retry.persisted.entries.length, 2, 'retry must not duplicate the entry');
          result = { afterFailure: {memory: failed.entries.length, disk: failed.persisted.entries.length}, afterRetry: retry.persisted.entries.map(e=>({value:e.value,date:e.date})), warning:failed.toast };
        } else if (scenario === 'delete-abort' || scenario === 'delete-cas') {
          if (scenario === 'delete-abort') await abortNextPut(page);
          else {
            const other = await context.newPage();
            await other.goto(origin + '/seed'); await other.addScriptTag({url:origin+'/js/local-store.js'});
            await other.evaluate(async user => {const data=await MGLocalStore.load(user.id); data.entries[0].detail='OTHER TAB'; await MGLocalStore.save(user.id,data);}, user);
          }
          await page.evaluate(id => { state.activeEntry=id; deleteEntry(); }, id);
          await page.locator('#confirmDelete').click();
          await page.waitForTimeout(150);
          const failed = await snapshot(page);
          assert.equal(failed.entries.length, 1, 'failed delete must be rolled back in memory');
          assert.equal(failed.persisted.entries.length, 1);
          assert.deepEqual(failed.queue, []);
          assert.deepEqual(errors, []);
          result = {memory:failed.entries.length,disk:failed.persisted.entries.length,queue:failed.queue,warning:failed.toast,unhandled:errors};
        } else if (scenario === 'settings-abort') {
          await page.evaluate(() => {openSettingsDialog('projection');currentBalanceInput.value='5000';balanceReferenceDateInput.value='2026-11-01';});
          await abortNextPut(page);
          await page.locator('#saveSettings').click();
          await page.waitForTimeout(100);
          const failed = await snapshot(page);
          assert.equal(failed.settings.current_balance,1000,'failed settings save must be rolled back');
          assert.equal(failed.persisted.settings.current_balance,1000);
          assert.deepEqual(errors,[]);
          result = {memory:failed.settings.current_balance,disk:failed.persisted.settings.current_balance,warning:failed.toast,unhandled:errors};
        } else if (scenario === 'installments-paid') {
          await page.evaluate(() => { openNew(); dateInput.value='2026-11-11'; valueInput.value='300'; flowType.value='expense'; renderEntryOptions('OUTROS','OUTROS'); recurrence.value='installments'; installments.value='3'; paidInput.checked=true; updateEntryFormVisibility(); });
          assert.equal(await page.locator('#paid').isVisible(),false,'paid checkbox must be hidden when creating installments');
          await page.locator('#saveEntry').click();
          await page.waitForFunction(() => !document.querySelector('#entryDialog').open);
          const after=await snapshot(page);
          const created=after.persisted.entries.filter(e=>e.id!==id);
          assert.equal(created.length,3);
          assert.ok(created.every(e=>e.paid===false));
          result={checkboxVisible:false,persisted:created.map(e=>({value:e.value,paid:e.paid,installment:e.installment.current}))};
        } else if (scenario === 'recurrence-detached') {
          result = await page.evaluate(() => {
            const series={id:'series',value:100,flow_type:'expense',type:'OUTROS',description:'OUTROS',detail:'standard'};
            const exception={...state.entries[0],id:'exception',date:'2026-12-01',scheduled_date:'2026-12-01',series_id:'series',value:999,detail:'CUSTOM EXCEPTION',detached_from_series:true};
            const reconciled=domain.reconcileSeriesEntries([exception],[{date:'2026-12-01',scheduled_date:'2026-12-01'}],series);
            return {upserts:reconciled.upserts.length,missing:reconciled.missingOccurrences.length,stale:reconciled.staleEntries.length};
          });
          assert.deepEqual(result,{upserts:0,missing:0,stale:0},'detached exception must keep its slot untouched');
        } else {
          result = await page.evaluate(() => {
            filterMonth.value='2026-12'; render();
            const first={period:decisionPeriodLabel.textContent,today:todayISO(),balance:currentBalanceTotal.textContent,end:monthEndBalanceTotal.textContent,seven:nextSevenDaysTotal.textContent,empty:rows.textContent};
            rows.querySelector('[data-empty-action]').click();
            return {...first,afterClear:rows.textContent,monthAfterClear:filterMonth.value};
          });
          assert.match(result.period,/dezembro/);
          assert.match(result.balance,/800/);
          assert.equal(result.monthAfterClear,'2026-12');
          assert.match(result.afterClear,/Nenhum lançamento em dezembro/,'an empty month must not blame the filters');
        }
        assert.ok(remote.every(url=>url==='https://accounts.google.com/gsi/client'),'no remote repository traffic');
        results.push({scenario,observed:result});
        console.log('OBSERVED',scenario,JSON.stringify(result));
      } finally { await context.close(); }
    }
    console.log('AUDIT synthetic scenarios verified:',results.length);
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
