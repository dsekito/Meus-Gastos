/* Run against python -m http.server 8000. Synthetic profiles, no Google access.
   Behaviour that used to be asserted by matching the text of js/app.js. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dayOffset = days => { const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + days); return iso(date); };
const today = dayOffset(0);
let sequence = 0;
const entry = (fields) => ({ id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`, date: today, type: 'MORADIA',
  description: 'ALUGUEL', flow_type: 'expense', value: 100, paid: false, created_at: `${today}T12:00:00Z`, updated_at: `${today}T12:00:00Z`, ...fields });

async function open(browser, profile, { view = 'records' } = {}) {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { errors.push(`native dialog: ${dialog.message()}`); return dialog.dismiss(); });
  await page.route('https://**/*', route => route.abort());
  await page.goto('http://localhost:8000');
  if (profile) {
    await page.evaluate(async (profile) => {
      const user = { id: 'behavior-test', email: 'behavior@example.invalid', user_metadata: { full_name: 'Teste' } };
      localStorage.setItem('meus-gastos-google-user', JSON.stringify(user));
      await MGLocalStore.save(user.id, { syncQueue: [], ...profile });
    }, profile);
    await page.reload();
  }
  await page.waitForSelector(profile ? '#appShell:not([hidden])' : '#authScreen:not([hidden])');
  if (profile && view) await page.locator(`.app-navigation [data-app-destination="${view}"]`).click();
  return { page, errors };
}

const settled = { onboarding_status: 'completed', current_balance: 1000, balance_reference_date: '2020-01-01' };
const stored = page => page.evaluate(async () => (await MGLocalStore.load('behavior-test', { observe: false })));
const toast = page => page.locator('#toast');
const rowsText = page => page.locator('#rows').innerText();
const card = (page, text) => page.locator('#rows [data-entry]', { hasText: text });

async function newEntry(page, { value, type = 'MORADIA', description = 'ALUGUEL', detail, recurrence, extra } = {}) {
  await page.locator('#openModalMobile').click();
  await page.locator('#entryDialog[open]').waitFor();
  await page.locator('#type').selectOption(type);
  await page.locator('#description').selectOption(description);
  await page.locator('#value').fill(String(value));
  if (detail || recurrence) await page.locator('#entryAdvanced > summary').click();
  if (detail) await page.locator('#detail').fill(detail);
  if (recurrence) await page.locator('#recurrence').selectOption(recurrence);
  if (extra) await extra();
}

const scenarios = {
  async recordsFiltersAndStatus(browser) {
    const { page, errors } = await open(browser, { settings: settled, entries: [
      entry({ description: 'ALUGUEL', paid: true }), entry({ type: 'ALIMENTAÇÃO', description: 'SUPERMERCADO' }),
      entry({ type: 'ALIMENTAÇÃO', description: 'RESTAURANTE' })] });
    // Every status is listed on arrival, paid ones included.
    assert.equal(await page.locator('#filterStatus').inputValue(), '');
    assert.equal(await page.locator('#rows [data-entry]').count(), 3);
    await page.locator('.filter-disclosure > summary').click();
    await page.locator('#filterDescription').selectOption('SUPERMERCADO');
    assert.equal(await page.locator('#rows [data-entry]').count(), 1);
    assert.match(await rowsText(page), /SUPERMERCADO/);
    await page.locator('#clearEntryFilters').click();
    assert.equal(await page.locator('#rows [data-entry]').count(), 3);

    // The status button only changes the status, and it can be undone.
    await card(page, 'RESTAURANTE').locator('[data-toggle-status]').click();
    await page.waitForFunction(() => /Status salvo/.test(document.querySelector('#toast').textContent));
    assert.equal(await page.locator('#entryDialog').evaluate(d => d.open), false);
    assert.equal((await stored(page)).entries.find(e => e.description === 'RESTAURANTE').paid, true);
    await toast(page).getByRole('button', { name: 'Desfazer' }).click();
    await page.waitForFunction(async () => !(await MGLocalStore.load('behavior-test', { observe: false })).entries.find(e => e.description === 'RESTAURANTE').paid);

    // A tap on the row opens it for editing.
    await card(page, 'SUPERMERCADO').locator('.entry-title').click();
    await page.locator('#entryDialog[open]').waitFor();
    assert.equal(await page.locator('#entryDialogTitle').innerText(), 'Editar lançamento');
    assert.equal(await page.locator('#saveAndAddAnother').isVisible(), false, 'repeat is only for new entries');
    await page.keyboard.press('Escape');

    // A long press selects; the selectable row names the type, not only its color.
    const box = await card(page, 'ALUGUEL').boundingBox();
    await page.mouse.move(box.x + 40, box.y + 20);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await page.waitForFunction(() => /selecionado/.test(document.querySelector('#panelTitle').textContent));
    assert.match(await card(page, 'SUPERMERCADO').getAttribute('aria-label'), /Selecionar SUPERMERCADO, tipo ALIMENTAÇÃO/);
    return { page, errors };
  },

  async deleteCanBeUndone(browser) {
    const { page, errors } = await open(browser, { settings: settled, entries: [entry({ description: 'ALUGUEL' }), entry({ description: 'CONDOMÍNIO' })] });
    await card(page, 'CONDOMÍNIO').locator('.entry-menu').click();
    await page.locator('#contextMenu [data-action="delete"]').click();
    await page.locator('#confirmDelete').click();
    await page.waitForFunction(() => /Lançamento excluído/.test(document.querySelector('#toast').textContent));
    assert.equal(await card(page, 'CONDOMÍNIO').count(), 0);
    await toast(page).getByRole('button', { name: 'Desfazer' }).click();
    await page.waitForFunction(() => /Lançamento restaurado/.test(document.querySelector('#toast').textContent));
    assert.equal(await card(page, 'CONDOMÍNIO').count(), 1);
    assert.equal((await stored(page)).entries.length, 2);
    return { page, errors };
  },

  async recordsManagerBulkEdit(browser) {
    const { page, errors } = await open(browser, { settings: settled, entries: [
      entry({ description: 'ALUGUEL' }), entry({ description: 'CONDOMÍNIO' }), entry({ type: 'LAZER', description: 'CINEMA' })] });
    await page.locator('#entryActions > summary').click();
    await page.locator('#openRecordsManagerMain').click();
    await page.locator('#recordsManagerDialog[open]').waitFor();
    assert.equal(await page.locator('[data-manager-select]').count(), 3);
    await page.locator('.manager-filters > summary').click();
    await page.locator('#managerFilterType').selectOption('MORADIA');
    assert.equal(await page.locator('[data-manager-select]').count(), 2);
    await page.locator('#managerSelectAll').click();
    assert.match(await page.locator('#managerSelectionSummary').innerText(), /2 selecionados/);
    await page.locator('#managerToggleBulk').click();
    await page.locator('#managerMarkPaid').click();
    await page.locator('#confirmDialog[open] [data-confirm-accept]').click();
    await page.waitForFunction(() => /2 registro\(s\) atualizado/.test(document.querySelector('#toast').textContent));
    let entries = (await stored(page)).entries;
    assert.deepEqual(entries.map(e => e.paid), [true, true, false]);
    // Selection is cleared after applying; select again to change the type.
    await page.locator('#managerSelectAll').click();
    await page.locator('#managerBulkType').selectOption('OUTROS');
    await page.locator('#managerApplyChanges').click();
    await page.locator('#confirmDialog[open] [data-confirm-accept]').click();
    await page.waitForFunction(async () => (await MGLocalStore.load('behavior-test', { observe: false })).entries.filter(e => e.type === 'OUTROS').length === 2);
    entries = (await stored(page)).entries;
    assert.equal(entries.find(e => e.description === 'CINEMA').type, 'LAZER', 'records outside the selection are untouched');
    return { page, errors };
  },

  async saveAndAddAnother(browser) {
    const { page, errors } = await open(browser, { settings: settled, entries: [] });
    await newEntry(page, { value: 12.5, type: 'ALIMENTAÇÃO', description: 'SUPERMERCADO', detail: 'feira' });
    const date = await page.locator('#date').inputValue();
    await page.locator('#saveAndAddAnother').click();
    await page.waitForFunction(() => !document.querySelector('#entryFormStatus').hidden);
    assert.match(await page.locator('#entryFormStatus').innerText(), /Os demais dados foram mantidos/);
    assert.equal(await page.locator('#entryDialog').evaluate(d => d.open), true);
    assert.equal(await page.locator('#value').inputValue(), '');
    assert.equal(await page.locator('#detail').inputValue(), '');
    assert.equal(await page.locator('#type').inputValue(), 'ALIMENTAÇÃO');
    assert.equal(await page.locator('#description').inputValue(), 'SUPERMERCADO');
    assert.equal(await page.locator('#date').inputValue(), date);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'value');

    // While saving, neither submit button accepts a second press.
    await page.evaluate(() => {
      const original = MGLocalStore.save;
      window.releaseSave = null;
      MGLocalStore.save = (...args) => new Promise(resolve => { window.releaseSave = () => { MGLocalStore.save = original; resolve(original(...args)); }; });
    });
    await page.locator('#value').fill('7');
    await page.locator('#saveEntry').click();
    await page.waitForFunction(() => typeof window.releaseSave === 'function');
    assert.equal(await page.locator('#saveEntry').isDisabled(), true);
    assert.equal(await page.locator('#saveAndAddAnother').isDisabled(), true);
    await page.evaluate(() => window.releaseSave());
    await page.locator('#entryDialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#saveEntry').isDisabled(), false);
    assert.deepEqual((await stored(page)).entries.map(e => e.value).sort(), [12.5, 7]);
    return { page, errors };
  },

  async descriptionsFollowRegisteredEntries(browser) {
    const { page, errors } = await open(browser, { settings: settled, entries: [entry({ type: 'ALIMENTAÇÃO', description: 'PADARIA DO BAIRRO' })] });
    await page.locator('#openModalMobile').click();
    await page.locator('#type').selectOption('ALIMENTAÇÃO');
    const options = await page.locator('#description option').allTextContents();
    assert.ok(options.includes('PADARIA DO BAIRRO'), 'a description already used for the type is offered');
    return { page, errors };
  },

  async installmentPlanIsReconciled(browser) {
    const { page, errors } = await open(browser, { settings: settled, entries: [] });
    await newEntry(page, { value: 300, recurrence: 'installments', extra: () => page.locator('#installments').fill('3') });
    await page.locator('#saveEntry').click();
    await page.locator('#entryDialog').waitFor({ state: 'hidden' });
    let entries = (await stored(page)).entries;
    assert.deepEqual(entries.map(e => e.value), [100, 100, 100]);
    await card(page, 'ALUGUEL').first().locator('.entry-title').click();
    assert.equal(await page.locator('#entryDialogTitle').innerText(), 'Editar compra parcelada');
    assert.equal(Number(await page.locator('#value').inputValue()), 300, 'the purchase total is edited, not one installment');
    await page.locator('#installments').fill('2');
    await page.locator('#saveEntry').click();
    await page.locator('#entryDialog').waitFor({ state: 'hidden' });
    entries = (await stored(page)).entries;
    assert.equal(entries.length, 2);
    assert.equal(entries.reduce((sum, e) => sum + Math.round(e.value * 100), 0), 30000);
    assert.deepEqual(entries.map(e => e.installment.total), [2, 2]);
    return { page, errors };
  },

  async recurringSeriesEditKeepsStatus(browser) {
    const { page, errors } = await open(browser, { settings: settled, entries: [] });
    await newEntry(page, { value: 80, recurrence: 'monthly', extra: async () => {
      await page.locator('#endMode').selectOption('after_occurrences');
      await page.locator('#occurrenceCount').fill('3');
    } });
    await page.locator('#saveEntry').click();
    await page.locator('#entryDialog').waitFor({ state: 'hidden' });
    let entries = (await stored(page)).entries;
    assert.equal(entries.length, 3);
    await card(page, 'ALUGUEL').first().locator('[data-toggle-status]').click();
    await page.waitForFunction(() => /Status salvo/.test(document.querySelector('#toast').textContent));
    await card(page, 'ALUGUEL').first().locator('.entry-title').click();
    await page.locator('#value').fill('95');
    await page.locator('#editScope').selectOption('all');
    await page.locator('#saveEntry').click();
    await page.locator('#entryDialog').waitFor({ state: 'hidden' });
    entries = (await stored(page)).entries.filter(e => !e.excluded_from_series);
    assert.equal(entries.length, 3, 'editing the whole series neither adds nor drops occurrences');
    assert.deepEqual(entries.map(e => e.value), [95, 95, 95]);
    assert.equal(entries.filter(e => e.paid).length, 1, 'the paid occurrence stays paid');
    // Another occurrence opens with the series' current values.
    await page.locator('#nextMonth').click();
    await card(page, 'ALUGUEL').first().locator('.entry-title').click();
    assert.equal(Number(await page.locator('#value').inputValue()), 95);
    await page.keyboard.press('Escape');

    // Deleting the whole series can be undone.
    await card(page, 'ALUGUEL').first().locator('.entry-menu').click();
    await page.locator('#contextMenu [data-action="delete"]').click();
    await page.locator('[data-series-delete-scope="all"]').click();
    await page.locator('#confirmDialog[open] [data-confirm-accept]').click();
    await page.waitForFunction(() => /Série recorrente excluída/.test(document.querySelector('#toast').textContent));
    assert.equal((await stored(page)).entries.filter(e => !e.excluded_from_series).length, 0);
    await toast(page).getByRole('button', { name: 'Desfazer' }).click();
    await page.waitForFunction(() => /Exclusão da recorrência desfeita/.test(document.querySelector('#toast').textContent));
    assert.equal((await stored(page)).entries.filter(e => !e.excluded_from_series).length, 3);
    return { page, errors };
  },

  async guidanceWarnsOnlyWhenBalanceRunsOut(browser) {
    const later = new Date(); later.setDate(1); later.setMonth(later.getMonth() + 3);
    const laterMonth = iso(later).slice(0, 7);
    const profile = extra => ({ settings: { onboarding_status: 'completed', current_balance: 100, balance_reference_date: today },
      entries: [entry({ date: dayOffset(2), value: 500 }), ...extra] });
    const guidance = async (page, month) => {
      await page.locator('#filterMonth').fill(month);
      await page.locator('#filterMonth').dispatchEvent('change');
      return (await page.locator('#financialGuidance').isVisible()) ? await page.locator('#financialGuidanceTitle').innerText() : null;
    };
    // The month ends below zero.
    let { page, errors } = await open(browser, profile([]), { view: 'home' });
    assert.equal(await guidance(page, laterMonth), 'Saldo negativo previsto');
    await page.close(); assert.deepEqual(errors, []);
    // The month recovers, but a bill in the next 7 days does not fit the balance.
    ({ page, errors } = await open(browser, profile([entry({ date: `${laterMonth}-10`, flow_type: 'income', type: 'RECEITAS', description: 'SALÁRIO', value: 10000 })]), { view: 'home' }));
    assert.equal(await guidance(page, laterMonth), 'Contas próximas acima do saldo previsto');
    await page.close(); assert.deepEqual(errors, []);
    // Upcoming bills that fit the balance raise no alert.
    ({ page, errors } = await open(browser, { settings: { onboarding_status: 'completed', current_balance: 1000, balance_reference_date: today },
      entries: [entry({ date: dayOffset(2), value: 50 })] }, { view: 'home' }));
    assert.equal(await guidance(page, today.slice(0, 7)), null);
    return { page, errors };
  },

  async onboardingAndDefaults(browser) {
    // A new profile starts at zero, with the universal categories, and is guided once.
    let { page, errors } = await open(browser, null);
    await page.locator('#useLocalProfile').click();
    await page.locator('#onboardingDialog[open]').waitFor();
    assert.equal(Number(await page.locator('#onboardingBalance').inputValue()), 0);
    await page.locator('#onboardingBalance').fill('250');
    await page.locator('#saveOnboarding').click();
    await page.locator('#onboardingDialog').waitFor({ state: 'hidden' });
    const profileId = await page.evaluate(() => state.user.id);
    const saved = await page.evaluate(async id => (await MGLocalStore.load(id, { observe: false })).settings, profileId);
    assert.equal(saved.onboarding_status, 'completed');
    assert.equal(saved.current_balance, 250);
    await page.locator('#openModalMobile').click();
    const types = await page.locator('#type option').allTextContents();
    for (const category of ['ALIMENTAÇÃO', 'MORADIA', 'RECEITAS', 'SAÚDE', 'TRANSPORTE']) assert.ok(types.includes(category), category);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.waitForSelector('#appShell:not([hidden])');
    assert.equal(await page.locator('#onboardingDialog').evaluate(d => d.open), false, 'shown only once');
    await page.close(); assert.deepEqual(errors, []);

    // An existing profile with records is never interrupted, and keeps its own categories.
    ({ page, errors } = await open(browser, { settings: { onboarding_status: 'pending', current_balance: 0 },
      types: ['MINHA CATEGORIA'], entries: [entry({ type: 'MINHA CATEGORIA', description: 'ITEM' })] }));
    assert.equal(await page.locator('#onboardingDialog').evaluate(d => d.open), false);
    await page.locator('#openModalMobile').click();
    const own = await page.locator('#type option').allTextContents();
    assert.ok(own.includes('MINHA CATEGORIA'));
    assert.ok(!own.includes('MORADIA'), 'default categories are not added to an existing profile');
    return { page, errors };
  },
};

(async () => {
  const only = process.argv[2];
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const [name, run] of Object.entries(scenarios)) {
      if (only && name !== only) continue;
      const { page, errors } = await run(browser);
      assert.deepEqual(errors, [], name);
      await page.close();
      console.log(`ok ${name}`);
    }
    console.log('app behaviour e2e: ok');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
