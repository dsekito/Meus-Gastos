// Filtros dos registros: movimentação, forma de pagamento, resumo dos filtros
// ativos e totais com sinal. App real em modo local, perfil sintético e
// relógio fixo; nenhuma conta ou requisição real.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const BASE_URL = process.env.MG_BASE_URL || 'http://localhost:8000';
const TODAY = '2026-11-13';

const entry = (n, date, type, description, value, paid, card) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, date, type, description, value, paid,
  flow_type: type === 'RECEITAS' ? 'income' : 'expense', created_at: '2026-11-01T10:00:00.000Z',
  ...(card ? { credit_card_id: card } : {}),
});
const ENTRIES = [
  entry(1, '2026-11-05', 'ALIMENTAÇÃO', 'RESTAURANTE', 80, true, 'nubank'),
  entry(2, '2026-11-08', 'ALIMENTAÇÃO', 'SUPERMERCADO', 320.5, true),
  entry(3, '2026-11-10', 'MORADIA', 'ALUGUEL', 1800, false),
  entry(4, '2026-11-15', 'TRANSPORTE', 'COMBUSTÍVEL', 250, false, 'itau'),
  entry(5, '2026-11-20', 'RECEITAS', 'SALÁRIO', 6000, false),
  entry(6, '2026-11-22', 'LAZER', 'PASSEIOS', 120, false, 'antigo'),
];
const CARDS = [{ id: 'nubank', name: 'Nubank', closing_day: 3, due_day: 10 }, { id: 'itau', name: 'Itaú', closing_day: 25, due_day: 5 }];

async function openRecords(browser, { entries, cards }) {
  const context = await browser.newContext({ viewport: { width: 320, height: 700 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto(BASE_URL);
  await page.getByRole('button', { name: 'Usar só neste aparelho' }).click();
  await page.waitForSelector('#syncStatus[data-state="local"]');
  await page.evaluate(async ({ entries, cards }) => {
    const { id } = JSON.parse(localStorage.getItem('meus-gastos-local-profile'));
    const current = await MGLocalStore.load(id, { observe: false });
    await MGLocalStore.compareAndSwap(id, current, {
      ...(current || {}), entries,
      settings: { current_balance: 0, balance_reference_date: '2026-11-01', onboarding_status: 'completed', ...(cards.length ? { credit_cards: cards } : {}) },
    });
  }, { entries, cards });
  await page.reload();
  await page.waitForSelector('#syncStatus[data-state="local"]');
  await page.getByRole('button', { name: 'Registros', exact: true }).click();
  return { context, page, errors };
}

const rows = page => page.locator('#rows [data-entry] .entry-title-text').allTextContents();
const totals = page => page.evaluate(() => ['#filteredIncome', '#filteredExpense', '#filteredBalance'].map(id => document.querySelector(id).textContent.replace(/\s/g, ' ')));
const noHorizontalScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    {
      const { context, page, errors } = await openRecords(browser, { entries: ENTRIES, cards: CARDS });

      // Padrão: só o que está a pagar ou a receber. O resumo diz isso, "Limpar"
      // fica desabilitado (já está no padrão) e os totais têm sinal.
      assert.equal(await page.textContent('#activeFiltersSummary'), 'A pagar / a receber');
      assert.equal(await page.textContent('#filtersToggleLabel'), 'Filtrar (1)');
      assert.equal(await page.isDisabled('#clearEntryFilters'), true);
      assert.deepEqual(await rows(page), ['ALUGUEL', 'COMBUSTÍVEL', 'SALÁRIO', 'PASSEIOS']);
      assert.deepEqual(await totals(page), ['+ R$ 6.000,00', '− R$ 2.170,00', '+ R$ 3.830,00']);

      // Todos os status: nenhum filtro ativo, e "Limpar" volta ao padrão.
      await page.locator('#filterStatus').evaluate(select => { select.value = ''; select.dispatchEvent(new Event('change')); });
      assert.equal(await page.textContent('#activeFiltersSummary'), 'Nenhum filtro ativo');
      assert.equal(await page.textContent('#filtersToggleLabel'), 'Filtrar');
      assert.equal(await page.isDisabled('#clearEntryFilters'), false);
      assert.deepEqual(await totals(page), ['+ R$ 6.000,00', '− R$ 2.570,50', '+ R$ 3.429,50']);
      assert.equal((await rows(page)).length, 6);

      // O cartão aparece no registro, por nome; um cartão excluído também é indicado.
      const cardTexts = await page.locator('#rows .entry-card').allTextContents();
      assert.deepEqual(cardTexts, ['Crédito: Nubank', 'Crédito: Itaú', 'Crédito: Cartão excluído'], 'leitor de tela ouve "Crédito"');
      assert.ok(await page.locator('#rows .entry-card .visually-hidden').evaluateAll(parts => parts.every(part => part.getBoundingClientRect().width <= 1)),
        'na tela, só o nome do cartão');

      await page.locator('.filter-disclosure > summary').click();
      assert.ok(await noHorizontalScroll(page), 'filtros cabem em 320 px');
      const paymentOptions = await page.locator('#filterPayment option').allTextContents();
      assert.deepEqual(paymentOptions, ['Todas as formas', 'Pix, débito ou dinheiro', 'Qualquer cartão de crédito', 'Crédito: Nubank', 'Crédito: Itaú', 'Cartão excluído']);

      // Um cartão.
      await page.locator('#filterPayment').selectOption({ label: 'Crédito: Nubank' });
      assert.deepEqual(await rows(page), ['RESTAURANTE']);
      assert.equal(await page.textContent('#activeFiltersSummary'), 'Crédito: Nubank');
      assert.equal(await page.textContent('#filtersToggleLabel'), 'Filtrar (1)');
      assert.equal(await page.isDisabled('#clearEntryFilters'), false);
      assert.deepEqual(await totals(page), ['+ R$ 0,00', '− R$ 80,00', '− R$ 80,00']);

      // Qualquer cartão, Pix (só despesas sem cartão) e cartão excluído.
      await page.locator('#filterPayment').selectOption({ label: 'Qualquer cartão de crédito' });
      assert.deepEqual(await rows(page), ['RESTAURANTE', 'COMBUSTÍVEL', 'PASSEIOS']);
      await page.locator('#filterPayment').selectOption({ label: 'Pix, débito ou dinheiro' });
      assert.deepEqual(await rows(page), ['SUPERMERCADO', 'ALUGUEL']);
      await page.locator('#filterPayment').selectOption({ label: 'Cartão excluído' });
      assert.deepEqual(await rows(page), ['PASSEIOS']);

      // Movimentação combinada com status.
      await page.locator('#filterPayment').selectOption('');
      await page.locator('#filterFlow').selectOption('expense');
      await page.locator('#filterStatus').selectOption('pending');
      assert.deepEqual(await rows(page), ['ALUGUEL', 'COMBUSTÍVEL', 'PASSEIOS']);
      assert.equal(await page.textContent('#activeFiltersSummary'), 'Só despesas · A pagar / a receber');
      assert.equal(await page.textContent('#filtersToggleLabel'), 'Filtrar (2)');
      await page.locator('#filterFlow').selectOption('income');
      assert.deepEqual(await rows(page), ['SALÁRIO']);
      assert.deepEqual(await totals(page), ['+ R$ 6.000,00', '− R$ 0,00', '+ R$ 6.000,00']);

      // "Selecionar filtrados" respeita os filtros novos.
      await page.locator('#filterFlow').selectOption('expense');
      await page.locator('#filterStatus').selectOption('');
      await page.locator('#filterPayment').selectOption({ label: 'Qualquer cartão de crédito' });
      assert.deepEqual(await rows(page), ['RESTAURANTE', 'COMBUSTÍVEL', 'PASSEIOS']);
      await page.evaluate(() => { document.querySelector('.filter-disclosure').open = false; });
      await page.locator('#rows [data-entry]').first().scrollIntoViewIfNeeded();
      const firstRow = await page.locator('#rows [data-entry]').first().boundingBox();
      await page.mouse.move(firstRow.x + 40, firstRow.y + 20);
      await page.mouse.down();
      await page.waitForTimeout(650);
      await page.mouse.up();
      await page.waitForFunction(() => /selecionado/.test(document.querySelector('#panelTitle').textContent));
      await page.locator('#selectAll').click();
      assert.equal(await page.textContent('#panelTitle'), '3 selecionados', 'seleciona só os 3 lançamentos filtrados');
      await page.locator('#exitSelection').click();
      await page.evaluate(() => { document.querySelector('.filter-disclosure').open = true; });

      // Limpar volta ao padrão: a pagar / a receber.
      await page.locator('#clearEntryFilters').click();
      assert.deepEqual(await rows(page), ['ALUGUEL', 'COMBUSTÍVEL', 'SALÁRIO', 'PASSEIOS']);
      assert.equal(await page.inputValue('#filterFlow'), '');
      assert.equal(await page.inputValue('#filterPayment'), '');
      assert.equal(await page.inputValue('#filterStatus'), 'pending');
      assert.equal(await page.textContent('#activeFiltersSummary'), 'A pagar / a receber');

      // Mês em que tudo já foi pago: a lista vazia oferece mostrar todos, inclusive os pagos.
      await page.locator('#filterPayment').selectOption({ label: 'Crédito: Nubank' });
      assert.deepEqual(await rows(page), []);
      await page.locator('#rows').getByRole('button', { name: 'Mostrar todos os lançamentos do período, inclusive os pagos' }).click();
      assert.equal(await page.inputValue('#filterStatus'), '');
      assert.equal((await rows(page)).length, 6);
      await page.locator('#clearEntryFilters').click();

      // Atalho de próximos vencimentos começa sem os filtros novos aplicados.
      await page.locator('#filterPayment').selectOption({ label: 'Crédito: Nubank' });
      await page.getByRole('button', { name: 'Início', exact: true }).click();
      const upcoming = page.locator('#upcomingList [data-upcoming-date]').first();
      assert.ok(await upcoming.count() > 0, 'há vencimentos nos próximos 7 dias');
      await upcoming.click();
      assert.equal(await page.inputValue('#filterPayment'), '', 'o atalho limpa a forma de pagamento');
      assert.equal(await page.inputValue('#filterFlow'), '');

      assert.deepEqual(errors, []);
      await context.close();
    }

    // Sem cartões nem lançamentos com cartão: o filtro de forma de pagamento não aparece.
    {
      const { context, page, errors } = await openRecords(browser, { entries: ENTRIES.map(({ credit_card_id, ...rest }) => rest), cards: [] });
      await page.locator('.filter-disclosure > summary').click();
      assert.equal(await page.isVisible('#filterPaymentField'), false);
      assert.ok(await page.isVisible('#filterFlow'));
      assert.equal(await page.locator('#rows .entry-card').count(), 0);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('records filters e2e: ok');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
