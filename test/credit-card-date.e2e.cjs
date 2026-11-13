// Cartão de crédito como forma de pagamento: cadastro nas configurações, data
// preenchida com o vencimento da fatura e cartão gravado no lançamento. App real em modo local, perfil
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
    await page.locator('#entryForm').getByLabel('Forma de pagamento').selectOption({ label: 'Crédito: Nubank' });
    // 13/11 é depois do fechamento (dia 3): a compra vai para a fatura que vence em 10/12.
    assert.equal(await page.inputValue('#date'), '2026-12-10');
    assert.match(await page.textContent('#creditCardHelp'), /vencimento da fatura do Nubank: 10\/12\/2026/);
    await page.locator('#entryForm').getByLabel('Forma de pagamento').selectOption({ label: 'Crédito: Itaú' });
    assert.equal(await page.inputValue('#date'), '2026-12-05');
    await page.locator('#entryForm').getByLabel('Forma de pagamento').selectOption({ label: 'Pix, débito ou dinheiro' });
    assert.equal(await page.inputValue('#date'), TODAY, 'voltar para Pix devolve a data de hoje');
    assert.ok(await noHorizontalScroll(page), 'formulário cabe em 320 px');

    // Uma data alterada à mão não é trocada por voltar para Pix.
    await page.locator('#entryForm').getByLabel('Forma de pagamento').selectOption({ label: 'Crédito: Nubank' });
    await page.fill('#date', '2026-12-15');
    assert.equal(await page.isVisible('#creditCardHelp'), false, 'o aviso some quando a data é editada');
    await page.locator('#entryForm').getByLabel('Forma de pagamento').selectOption({ label: 'Pix, débito ou dinheiro' });
    assert.equal(await page.inputValue('#date'), '2026-12-15');

    // Salvar grava a data escolhida e o cartão no lançamento.
    const cardId = name => stored(page, profileId).then(data => data.settings.credit_cards.find(card => card.name === name).id);
    const nubankId = await cardId('Nubank');
    const itauId = await cardId('Itaú');
    await page.locator('#entryForm').getByLabel('Forma de pagamento').selectOption({ label: 'Crédito: Nubank' });
    await page.fill('#value', '89.9');
    await page.selectOption('#type', 'ALIMENTAÇÃO');
    await page.selectOption('#description', 'RESTAURANTE');
    await page.locator('#saveEntry').click();
    await page.waitForSelector('#entryDialog:not([open])', { state: 'attached' });
    const [entry] = (await stored(page, profileId)).entries;
    assert.equal(entry.date, '2026-12-10');
    assert.equal(entry.value, 89.9);
    assert.equal(entry.credit_card_id, nubankId);

    // Ao abrir de novo, o formulário começa com a última forma usada, logo
    // após a movimentação, e a data já vem no vencimento da fatura.
    await openNewEntry(page);
    assert.equal(await page.evaluate(() => document.querySelector('#creditCardField').previousElementSibling.contains(document.querySelector('#flowType'))), true,
      'forma de pagamento logo após a movimentação');
    assert.equal(await page.inputValue('#creditCard'), nubankId);
    assert.equal(await page.inputValue('#date'), '2026-12-10');
    assert.match(await page.textContent('#creditCardHelp'), /^Última forma de pagamento usada\. Data preenchida com o vencimento da fatura do Nubank: 10\/12\/2026/);
    // Receitas não usam cartão: o campo some e a data volta para hoje.
    await page.selectOption('#flowType', 'income');
    assert.equal(await page.isVisible('#creditCardField'), false);
    assert.equal(await page.inputValue('#date'), TODAY);
    await page.locator('#entryForm [data-close]').first().click();

    // Edição mostra o cartão do lançamento; trocar o cartão não muda a data.
    const storedEntry = async () => (await stored(page, profileId)).entries.find(item => item.id === entry.id);
    async function editSavedEntry() {
      await page.locator(`[data-entry="${entry.id}"]`).first().click();
      await page.waitForSelector('#entryDialog[open]');
      assert.equal(await page.textContent('#entryDialogTitle'), 'Editar lançamento');
    }
    async function saveEdit() {
      await page.locator('#saveEntry').click();
      await page.waitForSelector('#entryDialog:not([open])', { state: 'attached' });
    }
    await page.getByRole('button', { name: 'Registros', exact: true }).click();
    await page.locator('#nextMonth').click();
    await editSavedEntry();
    assert.ok(await page.isVisible('#creditCardField'), 'a edição oferece a forma de pagamento');
    assert.equal(await page.inputValue('#creditCard'), nubankId);
    await page.locator('#entryForm').getByLabel('Forma de pagamento').selectOption({ label: 'Crédito: Itaú' });
    assert.equal(await page.inputValue('#date'), '2026-12-10', 'a data do lançamento existente não muda');
    assert.equal(await page.textContent('#creditCardHelp'), 'A data do lançamento não muda ao trocar a forma de pagamento.');
    assert.ok(await noHorizontalScroll(page), 'edição cabe em 320 px');
    await saveEdit();
    assert.equal((await storedEntry()).credit_card_id, itauId);
    assert.equal((await storedEntry()).date, '2026-12-10');

    // Voltar para Pix tira o cartão do lançamento.
    await editSavedEntry();
    await page.locator('#entryForm').getByLabel('Forma de pagamento').selectOption({ label: 'Pix, débito ou dinheiro' });
    await saveEdit();
    assert.equal('credit_card_id' in await storedEntry(), false);

    // Lançamento sem cartão: a edição começa em Pix e pode receber um cartão.
    await editSavedEntry();
    assert.equal(await page.inputValue('#creditCard'), '');
    await page.locator('#entryForm').getByLabel('Forma de pagamento').selectOption({ label: 'Crédito: Nubank' });
    await saveEdit();
    assert.equal((await storedEntry()).credit_card_id, nubankId);

    // Excluir o cartão pede confirmação e preserva o lançamento já feito.
    await openCardSettings(page);
    await page.getByRole('button', { name: 'Excluir cartão Nubank' }).click();
    await page.waitForSelector('#confirmDialog[open]');
    await page.locator('#confirmDialog [data-confirm-accept]').click();
    await page.waitForFunction(() => !document.querySelector('#creditCardList').innerText.includes('Nubank'));
    const afterRemoval = await stored(page, profileId);
    assert.deepEqual(afterRemoval.settings.credit_cards.map(card => card.name), ['Itaú']);
    assert.equal(afterRemoval.entries[0].date, '2026-12-10');
    assert.equal(afterRemoval.entries[0].credit_card_id, nubankId);

    // Editar um lançamento de cartão excluído mostra "Cartão excluído" e não o apaga ao salvar.
    await page.locator('[data-close-settings]').first().click();
    await editSavedEntry();
    assert.equal(await page.inputValue('#creditCard'), nubankId);
    assert.equal(await page.locator('#creditCard option:checked').textContent(), 'Cartão excluído');
    await page.fill('#value', '90');
    await saveEdit();
    assert.equal((await storedEntry()).credit_card_id, nubankId);
    assert.equal((await storedEntry()).value, 90);

    // Compra parcelada no cartão: todas as parcelas levam o cartão; a edição troca em todas.
    await openNewEntry(page);
    await page.locator('#entryForm').getByLabel('Forma de pagamento').selectOption({ label: 'Crédito: Itaú' });
    await page.fill('#value', '300');
    await page.selectOption('#type', 'COMPRAS');
    await page.selectOption('#description', 'CASA');
    await page.locator('#entryAdvanced summary').click();
    await page.selectOption('#recurrence', 'installments');
    await page.fill('#installments', '3');
    await page.locator('#saveEntry').click();
    await page.waitForSelector('#entryDialog:not([open])', { state: 'attached' });
    const installments = async () => (await stored(page, profileId)).entries.filter(item => item.installment);
    assert.deepEqual((await installments()).map(item => [item.date, item.credit_card_id]),
      [['2026-12-05', itauId], ['2027-01-05', itauId], ['2027-02-05', itauId]]);
    const firstInstallment = (await installments()).find(item => item.installment.current === 1);
    await page.locator(`[data-entry="${firstInstallment.id}"]`).first().click();
    await page.waitForSelector('#entryDialog[open]');
    assert.equal(await page.inputValue('#creditCard'), itauId);
    await page.locator('#entryForm').getByLabel('Forma de pagamento').selectOption({ label: 'Pix, débito ou dinheiro' });
    await saveEdit();
    assert.ok((await installments()).every(item => !('credit_card_id' in item)), 'a troca vale para todas as parcelas');

    // Recorrência mensal no cartão: a série e as ocorrências levam o cartão;
    // editar "Em toda a série" troca em todas.
    await openNewEntry(page);
    await page.locator('#entryForm').getByLabel('Forma de pagamento').selectOption({ label: 'Crédito: Itaú' });
    await page.fill('#value', '39.9');
    await page.selectOption('#type', 'ASSINATURAS');
    await page.selectOption('#description', 'STREAMING');
    await page.locator('#entryAdvanced summary').click();
    await page.selectOption('#recurrence', 'monthly');
    await page.locator('#saveEntry').click();
    await page.waitForSelector('#entryDialog:not([open])', { state: 'attached' });
    const recurring = async () => {
      const data = await stored(page, profileId);
      return { series: data.recurrenceSeries[0], entries: data.entries.filter(item => item.series_id === data.recurrenceSeries[0].id) };
    };
    let subscription = await recurring();
    assert.equal(subscription.series.credit_card_id, itauId);
    assert.ok(subscription.entries.length > 1 && subscription.entries.every(item => item.credit_card_id === itauId));
    const firstOccurrence = subscription.entries.sort((a, b) => a.date.localeCompare(b.date))[0];
    await page.locator(`[data-entry="${firstOccurrence.id}"]`).first().click();
    await page.waitForSelector('#entryDialog[open]');
    assert.equal(await page.inputValue('#creditCard'), itauId);
    await page.locator('#entryForm').getByLabel('Forma de pagamento').selectOption({ label: 'Pix, débito ou dinheiro' });
    await page.selectOption('#editScope', 'all');
    await saveEdit();
    subscription = await recurring();
    assert.equal('credit_card_id' in subscription.series, false);
    assert.ok(subscription.entries.every(item => !('credit_card_id' in item)), 'a troca vale para toda a série');

    // O cartão e a última forma usada continuam depois de recarregar o app.
    await page.reload();
    await page.waitForSelector('#syncStatus[data-state="local"]');
    await openNewEntry(page);
    assert.equal(await page.inputValue('#creditCard'), itauId, 'a última forma usada foi o Itaú');
    assert.equal(await page.inputValue('#date'), '2026-12-05');

    // Um lançamento novo salvo com Pix faz o próximo começar em Pix e hoje.
    await page.locator('#entryForm').getByLabel('Forma de pagamento').selectOption({ label: 'Pix, débito ou dinheiro' });
    assert.equal(await page.inputValue('#date'), TODAY);
    await page.fill('#value', '12');
    await page.selectOption('#type', 'ALIMENTAÇÃO');
    await page.selectOption('#description', 'SUPERMERCADO');
    await page.locator('#saveEntry').click();
    await page.waitForSelector('#entryDialog:not([open])', { state: 'attached' });
    await openNewEntry(page);
    assert.equal(await page.inputValue('#creditCard'), '');
    assert.equal(await page.inputValue('#date'), TODAY);
    assert.equal(await page.isVisible('#creditCardHelp'), false);
    await page.locator('#entryForm [data-close]').first().click();

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
