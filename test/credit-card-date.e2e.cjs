// Cartão de crédito como forma de pagamento: cadastro nas configurações e data
// preenchida com o vencimento da fatura. App real em modo local, perfil
// sintético e relógio fixo; nenhuma conta ou requisição real.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const BASE_URL = process.env.MG_BASE_URL || 'http://localhost:8000';
const TODAY = '2026-11-13';

async function openLocalProfile(browser, viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto(BASE_URL);
  await page.getByRole('button', { name: 'Usar só neste aparelho' }).click();
  await page.waitForSelector('#syncStatus[data-state="local"]');
  const profileId = await page.evaluate(async today => {
    const { id } = JSON.parse(localStorage.getItem('meus-gastos-local-profile'));
    const current = await MGLocalStore.load(id, { observe: false });
    await MGLocalStore.compareAndSwap(id, current, {
      ...(current || {}),
      settings: { current_balance: 500, balance_reference_date: today, onboarding_status: 'completed' },
    });
    return id;
  }, TODAY);
  await page.reload();
  await page.waitForSelector('#syncStatus[data-state="local"]');
  return { context, page, errors, profileId };
}

const stored = (page, id) => page.evaluate(key => MGLocalStore.load(key, { observe: false }), id);
const noHorizontalScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function openCardSettings(page) {
  await page.evaluate(() => document.querySelector('[data-settings-topic="options"]').click());
  await page.waitForSelector('#settingsDialog[open]');
  await page.locator('#creditCardName').scrollIntoViewIfNeeded();
}

async function addCard(page, name, closingDay, dueDay) {
  await page.getByLabel('Nome do cartão').fill(name);
  await page.getByLabel('Dia do fechamento').fill(String(closingDay));
  await page.getByLabel('Dia do vencimento').fill(String(dueDay));
  await page.getByRole('button', { name: 'Adicionar cartão' }).click();
  await page.waitForFunction(text => document.querySelector('#creditCardList').innerText.includes(text), name);
}

async function openNewEntry(page) {
  if (await page.locator('#settingsDialog[open]').count()) await page.locator('[data-close-settings]').first().click();
  await page.locator('#openModal:visible, #openModalMobile:visible').first().click();
  await page.waitForSelector('#entryDialog[open]');
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const { context, page, errors, profileId } = await openLocalProfile(browser, { width: 320, height: 700 });

    // Sem cartão cadastrado, o formulário não mostra a forma de pagamento.
    await openNewEntry(page);
    assert.equal(await page.isVisible('#creditCardField'), false, 'sem cartões, o campo fica oculto');
    await page.locator('#entryForm [data-close]').first().click();

    // Cadastro: dados inválidos explicam o que corrigir e não salvam nada.
    await openCardSettings(page);
    assert.ok(await page.isVisible('#creditCardEmpty'));
    await page.getByLabel('Nome do cartão').fill('Nubank');
    await page.getByLabel('Dia do fechamento').fill('3');
    await page.getByLabel('Dia do vencimento').fill('32');
    await page.getByLabel('Dia do vencimento').press('Enter');
    assert.equal(await page.textContent('#creditCardError'), 'Informe o dia do vencimento da fatura, de 1 a 31.');
    assert.equal(await page.getAttribute('#creditCardDueDay', 'aria-invalid'), '');
    assert.ok(await page.locator('#settingsDialog[open]').count(), 'Enter não envia o formulário da projeção');
    assert.deepEqual((await stored(page, profileId)).settings.credit_cards ?? [], []);

    await addCard(page, 'Nubank', 3, 10);
    await addCard(page, 'Itaú', 25, 5);
    assert.equal(await page.isVisible('#creditCardEmpty'), false);
    assert.ok(await noHorizontalScroll(page), 'configurações cabem em 320 px');
    const removeBox = await page.getByRole('button', { name: 'Excluir cartão Nubank' }).boundingBox();
    assert.ok(removeBox.height >= 48, 'botão de excluir com 48 px de altura');
    const saved = (await stored(page, profileId)).settings.credit_cards;
    assert.deepEqual(saved.map(({ name, closing_day, due_day }) => [name, closing_day, due_day]), [['Nubank', 3, 10], ['Itaú', 25, 5]]);
    assert.equal((await stored(page, profileId)).settingsDirty, true, 'o cadastro entra na fila de sincronização');

    await page.getByLabel('Nome do cartão').fill('nubank');
    await page.getByLabel('Dia do fechamento').fill('1');
    await page.getByLabel('Dia do vencimento').fill('8');
    await page.getByRole('button', { name: 'Adicionar cartão' }).click();
    assert.match(await page.textContent('#creditCardError'), /Já existe um cartão chamado “nubank”/);
    await page.getByLabel('Nome do cartão').fill('');

    // Novo lançamento: escolher o cartão preenche a data com o vencimento.
    await openNewEntry(page);
    assert.ok(await page.isVisible('#creditCardField'));
    assert.equal(await page.inputValue('#date'), TODAY);
    await page.getByLabel('Forma de pagamento').selectOption({ label: 'Crédito: Nubank' });
    // 13/11 é depois do fechamento (dia 3): a compra vai para a fatura que vence em 10/12.
    assert.equal(await page.inputValue('#date'), '2026-12-10');
    assert.match(await page.textContent('#creditCardHelp'), /vencimento da fatura do Nubank: 10\/12\/2026/);
    await page.getByLabel('Forma de pagamento').selectOption({ label: 'Crédito: Itaú' });
    assert.equal(await page.inputValue('#date'), '2026-12-05');
    await page.getByLabel('Forma de pagamento').selectOption({ label: 'Pix, débito ou dinheiro' });
    assert.equal(await page.inputValue('#date'), TODAY, 'voltar para Pix devolve a data de hoje');
    assert.ok(await noHorizontalScroll(page), 'formulário cabe em 320 px');

    // Uma data alterada à mão não é trocada por voltar para Pix.
    await page.getByLabel('Forma de pagamento').selectOption({ label: 'Crédito: Nubank' });
    await page.fill('#date', '2026-12-15');
    assert.equal(await page.isVisible('#creditCardHelp'), false, 'o aviso some quando a data é editada');
    await page.getByLabel('Forma de pagamento').selectOption({ label: 'Pix, débito ou dinheiro' });
    assert.equal(await page.inputValue('#date'), '2026-12-15');

    // Salvar grava a data escolhida; o cartão não é gravado no lançamento.
    await page.getByLabel('Forma de pagamento').selectOption({ label: 'Crédito: Nubank' });
    await page.fill('#value', '89.9');
    await page.selectOption('#type', 'ALIMENTAÇÃO');
    await page.selectOption('#description', 'RESTAURANTE');
    await page.locator('#saveEntry').click();
    await page.waitForSelector('#entryDialog:not([open])', { state: 'attached' });
    const [entry] = (await stored(page, profileId)).entries;
    assert.equal(entry.date, '2026-12-10');
    assert.equal(entry.value, 89.9);
    assert.equal('credit_card' in entry || 'payment_method' in entry, false);

    // Ao abrir de novo, o formulário recomeça em Pix e hoje.
    await openNewEntry(page);
    assert.equal(await page.inputValue('#creditCard'), '');
    assert.equal(await page.inputValue('#date'), TODAY);
    // Receitas não usam cartão.
    await page.selectOption('#flowType', 'income');
    assert.equal(await page.isVisible('#creditCardField'), false);
    await page.locator('#entryForm [data-close]').first().click();

    // Edição não oferece cartão nem muda a data do lançamento.
    await page.getByRole('button', { name: 'Registros', exact: true }).click();
    await page.locator('#nextMonth').click();
    await page.locator(`[data-entry="${entry.id}"]`).first().click();
    await page.waitForSelector('#entryDialog[open]');
    assert.equal(await page.textContent('#entryDialogTitle'), 'Editar lançamento');
    assert.equal(await page.isVisible('#creditCardField'), false, 'a edição não oferece cartão');
    assert.equal(await page.inputValue('#date'), '2026-12-10');
    await page.locator('#entryForm [data-close]').first().click();

    // Excluir pede confirmação e preserva o lançamento já feito.
    await openCardSettings(page);
    await page.getByRole('button', { name: 'Excluir cartão Nubank' }).click();
    await page.waitForSelector('#confirmDialog[open]');
    await page.locator('#confirmDialog [data-confirm-accept]').click();
    await page.waitForFunction(() => !document.querySelector('#creditCardList').innerText.includes('Nubank'));
    const afterRemoval = await stored(page, profileId);
    assert.deepEqual(afterRemoval.settings.credit_cards.map(card => card.name), ['Itaú']);
    assert.equal(afterRemoval.entries[0].date, '2026-12-10');

    // O cartão continua salvo depois de recarregar o app.
    await page.reload();
    await page.waitForSelector('#syncStatus[data-state="local"]');
    await openNewEntry(page);
    await page.getByLabel('Forma de pagamento').selectOption({ label: 'Crédito: Itaú' });
    assert.equal(await page.inputValue('#date'), '2026-12-05');

    assert.deepEqual(errors, []);
    await context.close();
    console.log('credit card date e2e: ok');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
