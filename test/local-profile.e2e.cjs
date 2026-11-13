// Modo local e migração para o Google: app real, perfil sintético, Google
// Identity e Drive simulados. Nenhuma conta ou requisição real.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const BASE_URL = process.env.MG_BASE_URL || 'http://localhost:8000';
const GOOGLE_USER = { id: 'e2e-google-user', email: 'local-e2e@example.invalid', user_metadata: { full_name: 'Pessoa Teste' } };
const LOCAL_ENTRY = { id: '00000000-0000-4000-8000-0000000000a1', value: 42.37, type: 'ALIMENTAÇÃO', description: 'FEIRA LOCAL E2E', paid: false, created_at: '2026-11-01T10:00:00.000Z' };
const DRIVE_ENTRY = { id: '00000000-0000-4000-8000-0000000000d1', value: 15, type: 'ALIMENTAÇÃO', description: 'PADARIA DRIVE E2E', paid: false, updated_at: '2026-10-01T10:00:00.000Z' };

const fakeAuth = `window.MGGoogleAuth={create:()=>{let token=null;const KEY='meus-gastos-google-user';return{
  restoreSession:()=>JSON.parse(localStorage.getItem(KEY)||'null'),
  signIn:async()=>{token='fake-test-token';const user=${JSON.stringify(GOOGLE_USER)};localStorage.setItem(KEY,JSON.stringify(user));return user;},
  signOut:async()=>{token=null;localStorage.removeItem(KEY);},
  clearToken:()=>{token=null;},getAccessToken:()=>token,hasAccessToken:()=>!!token,isAccessTokenExpired:()=>false};}};`;

async function openApp(browser, drive) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/js/google-auth.js?*', route => route.fulfill({ contentType: 'application/javascript', body: fakeAuth }));
  await page.route('https://**/*', async route => {
    const request = route.request();
    const url = request.url();
    const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    if (!url.includes('www.googleapis.com')) return route.abort();
    drive.requests++;
    if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
      const body = request.postDataBuffer().toString('utf8');
      drive.remote = JSON.parse(body.slice(body.indexOf('{"schemaVersion"'), body.lastIndexOf('}') + 1));
      drive.version = 1;
      drive.uploads.push(structuredClone(drive.remote));
      return json({ id: 'main', version: '1' });
    }
    if (url.includes('/upload/drive/v3/files/main?uploadType=media')) {
      drive.remote = JSON.parse(request.postData());
      drive.version++;
      drive.uploads.push(structuredClone(drive.remote));
      return json({ id: 'main', version: String(drive.version) });
    }
    if (url.includes('/drive/v3/files?')) {
      const q = new URL(url).searchParams.get('q') || '';
      const main = q.includes("name = 'meus-gastos.json'") && drive.remote;
      return json({ files: main ? [{ id: 'main', name: 'meus-gastos.json', version: String(drive.version) }] : [] });
    }
    if (url.includes('/files/main?alt=media')) return json(drive.remote);
    if (url.includes('/files/main?fields=version')) return json({ version: String(drive.version) });
    throw new Error(`Requisição Google inesperada: ${url}`);
  });
  await page.goto(BASE_URL);
  return { context, page, errors };
}

// Cria o perfil pelo botão e grava um lançamento sintético nele.
async function startLocalWithEntry(page) {
  await page.waitForSelector('#authScreen:not([hidden])');
  const google = page.getByRole('button', { name: 'Continuar com sua conta Google' });
  const local = page.getByRole('button', { name: 'Usar só neste aparelho' });
  await google.waitFor();
  await local.waitFor();
  const [googleBox, localBox] = [await google.boundingBox(), await local.boundingBox()];
  assert.ok(localBox.height >= 48 && googleBox.height >= 48, 'áreas de toque de 48 px');
  assert.ok(localBox.y - (googleBox.y + googleBox.height) >= 8, '8 px entre alvos');
  await local.click();
  await page.waitForSelector('#appShell:not([hidden])');
  await page.waitForSelector('#syncStatus[data-state="local"]');
  const localId = await page.evaluate(async entry => {
    const { id } = JSON.parse(localStorage.getItem('meus-gastos-local-profile'));
    const current = await MGLocalStore.load(id, { observe: false });
    const date = new Date().toISOString().slice(0, 10);
    await MGLocalStore.compareAndSwap(id, current, {
      ...(current || {}),
      entries: [{ ...entry, date }],
      settings: { current_balance: 500, balance_reference_date: date, onboarding_status: 'completed' },
      syncQueue: [{ type: 'upsert', entry: { ...entry, date }, baseUpdatedAt: null, mutationId: 'e2e-local' }],
    });
    return id;
  }, LOCAL_ENTRY);
  assert.match(localId, /^local:[0-9a-f-]{36}$/);
  await page.reload();
  await page.waitForSelector('#syncStatus[data-state="local"]');
  assert.equal(await page.textContent('#syncStatus'), 'Modo local');
  await page.waitForFunction(text => document.body.innerText.includes(text), LOCAL_ENTRY.description);
  return localId;
}

const stored = (page, id) => page.evaluate(key => MGLocalStore.load(key, { observe: false }), id);
const localPointer = page => page.evaluate(() => localStorage.getItem('meus-gastos-local-profile'));
const googleSession = page => page.evaluate(() => localStorage.getItem('meus-gastos-google-user'));

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    // 1. Sem dados no Drive: migra direto e envia.
    {
      const drive = { remote: null, version: 0, uploads: [], requests: 0 };
      const { context, page, errors } = await openApp(browser, drive);
      await page.setViewportSize({ width: 320, height: 700 });
      await page.waitForSelector('#authScreen:not([hidden])');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'sem rolagem horizontal em 320 px');
      await page.setViewportSize({ width: 375, height: 812 });
      const localId = await startLocalWithEntry(page);
      assert.equal(drive.requests, 0, 'o modo local não acessa a internet');
      assert.equal(await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }), false, 'modo local não pede confirmação ao sair');
      await page.getByRole('button', { name: 'Conectar sua conta Google para sincronizar' }).first().click();
      await page.waitForSelector('#syncStatus[data-state="synced"]');
      assert.equal(await localPointer(page), null, 'perfil local removido após a migração');
      assert.equal(await stored(page, localId), undefined);
      const account = await stored(page, GOOGLE_USER.id);
      assert.deepEqual(account.entries.map(entry => entry.id), [LOCAL_ENTRY.id]);
      assert.equal(account.syncQueue.length, 0);
      assert.deepEqual(drive.remote.entries.map(entry => entry.id), [LOCAL_ENTRY.id]);
      assert.equal(drive.remote.entries[0].value, 42.37);
      assert.equal(drive.remote.settings.current_balance, 500);
      await page.reload();
      await page.waitForSelector('#appShell:not([hidden])');
      assert.equal(await localPointer(page), null);
      assert.ok(await googleSession(page), 'a sessão Google é restaurada depois da migração');
      assert.deepEqual(errors, []);
      await context.close();
    }

    // 2. Drive com dados: conflito explícito; cancelar não muda nada; depois
    //    "manter os deste aparelho" substitui o Drive.
    {
      const date = new Date().toISOString().slice(0, 10);
      const drive = { version: 3, uploads: [], requests: 0, remote: { schemaVersion: 2, revision: 3, updatedAt: '2026-10-01T10:00:00.000Z', entries: [{ ...DRIVE_ENTRY, date }], recurrenceSeries: [], settings: { current_balance: 80, balance_reference_date: date, onboarding_status: 'completed' }, tombstones: {}, compactedDeltas: {} } };
      const { context, page, errors } = await openApp(browser, drive);
      const localId = await startLocalWithEntry(page);
      const financial = record => ({ entries: record.entries, settings: record.settings, syncQueue: record.syncQueue });
      const before = financial(await stored(page, localId));
      await page.getByRole('button', { name: 'Conectar sua conta Google para sincronizar' }).first().click();
      await page.waitForSelector('#localMigrationDialog[open]');
      assert.match(await page.textContent('#localMigrationSummary'), /Neste aparelho: 1 lançamento\. Na sua conta Google: 1 lançamento\./);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.migrationChoice), 'cancel', 'foco inicial na opção segura');
      await page.locator('#localMigrationDialog').getByRole('button', { name: /^Cancelar/ }).click();
      await page.waitForFunction(() => !document.querySelector('#localMigrationDialog').open);
      await page.waitForFunction(() => localStorage.getItem('meus-gastos-google-user') === null);
      await page.waitForSelector('#syncStatus[data-state="local"]');
      assert.ok(await localPointer(page), 'continua no modo local');
      assert.equal(await googleSession(page), null, 'sessão Google descartada ao cancelar');
      assert.deepEqual(financial(await stored(page, localId)), before, 'nada mudou ao cancelar');
      assert.equal(await stored(page, GOOGLE_USER.id), undefined);
      assert.equal(drive.uploads.length, 0, 'o Drive não foi alterado');

      await page.getByRole('button', { name: 'Conectar sua conta Google para sincronizar' }).first().click();
      await page.waitForSelector('#localMigrationDialog[open]');
      await page.locator('#localMigrationDialog').getByRole('button', { name: /^Manter os deste aparelho/ }).click();
      await page.waitForSelector('#syncStatus[data-state="synced"]');
      assert.equal(await localPointer(page), null);
      assert.equal(await stored(page, localId), undefined);
      assert.deepEqual(drive.remote.entries.map(entry => entry.id), [LOCAL_ENTRY.id]);
      assert.ok(drive.remote.tombstones[DRIVE_ENTRY.id], 'o lançamento que só existia no Drive foi removido por escolha explícita');
      assert.equal(drive.remote.settings.current_balance, 500);
      assert.deepEqual(errors, []);
      await context.close();
    }

    // 3. Drive com dados: "manter os do Google Drive" carrega o Drive sem enviar nada do aparelho.
    {
      const date = new Date().toISOString().slice(0, 10);
      const drive = { version: 3, uploads: [], requests: 0, remote: { schemaVersion: 2, revision: 3, updatedAt: '2026-10-01T10:00:00.000Z', entries: [{ ...DRIVE_ENTRY, date }], recurrenceSeries: [], settings: { current_balance: 80, balance_reference_date: date, onboarding_status: 'completed' }, tombstones: {}, compactedDeltas: {} } };
      const { context, page, errors } = await openApp(browser, drive);
      const localId = await startLocalWithEntry(page);
      await page.getByRole('button', { name: 'Conectar sua conta Google para sincronizar' }).first().click();
      await page.waitForSelector('#localMigrationDialog[open]');
      await page.locator('#localMigrationDialog').getByRole('button', { name: /^Manter os do Google Drive/ }).click();
      await page.waitForSelector('#syncStatus[data-state="synced"]');
      assert.equal(await stored(page, localId), undefined);
      assert.equal(await localPointer(page), null);
      assert.ok(drive.uploads.every(upload => !upload.entries.some(entry => entry.id === LOCAL_ENTRY.id)), 'nada do aparelho foi enviado');
      assert.deepEqual(drive.remote.entries.map(entry => entry.id), [DRIVE_ENTRY.id]);
      await page.waitForFunction(text => document.body.innerText.includes(text), DRIVE_ENTRY.description);
      const account = await stored(page, GOOGLE_USER.id);
      assert.deepEqual(account.entries.map(entry => entry.id), [DRIVE_ENTRY.id]);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Modo local: entrada sem conta, migração sem conflito, cancelar, manter aparelho e manter Drive OK');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
