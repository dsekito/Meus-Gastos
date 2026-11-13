// Lançamento salvo em outro mês: a mensagem diz a data e leva até o mês, para
// o registro não parecer perdido. App real em modo local, perfil sintético e
// relógio fixo; nenhuma conta ou requisição real.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const BASE_URL = process.env.MG_BASE_URL || 'http://localhost:8000';
const TODAY = '2026-11-13';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 320, height: 700 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
    await page.goto(BASE_URL);
    await page.getByRole('button', { name: 'Usar só neste aparelho' }).click();
    await page.waitForSelector('#syncStatus[data-state="local"]');
    await page.evaluate(async today => {
      const { id } = JSON.parse(localStorage.getItem('meus-gastos-local-profile'));
      const current = await MGLocalStore.load(id, { observe: false });
      await MGLocalStore.compareAndSwap(id, current, {
        ...(current || {}),
        settings: { current_balance: 0, balance_reference_date: today, onboarding_status: 'completed' },
      });
    }, TODAY);
    await page.reload();
    await page.waitForSelector('#syncStatus[data-state="local"]');

    async function saveEntry(date, description) {
      await page.locator('#openModal:visible, #openModalMobile:visible').first().click();
      await page.waitForSelector('#entryDialog[open]');
      await page.fill('#value', '25');
      await page.fill('#date', date);
      await page.selectOption('#type', 'ALIMENTAÇÃO');
      await page.selectOption('#description', description);
      await page.locator('#saveEntry').click();
      await page.waitForSelector('#entryDialog:not([open])', { state: 'attached' });
      return page.textContent('#toast');
    }

    // No mês exibido: a mensagem de sempre, sem botão.
    const sameMonth = await saveEntry('2026-11-20', 'RESTAURANTE');
    assert.equal(sameMonth, 'Lançamento salvo neste dispositivo. Sincronização pendente.');
    assert.equal(await page.locator('#toast button').count(), 0);

    // Em outro mês: a mensagem diz a data e o botão leva até o mês, nos registros.
    const otherMonth = await saveEntry('2026-12-10', 'DELIVERY');
    assert.match(otherMonth, /Data: 10\/12\/2026, fora do mês exibido\./);
    const goToMonth = page.locator('#toast').getByRole('button', { name: 'Ver dezembro' });
    const box = await goToMonth.boundingBox();
    assert.ok(box.height >= 44, 'botão da mensagem com área de toque');
    await goToMonth.click();
    assert.equal(await page.inputValue('#filterMonth'), '2026-12');
    assert.equal(await page.getAttribute('.app-navigation [data-app-destination="records"]', 'aria-current'), 'page');
    await page.waitForFunction(() => document.querySelector('[data-app-panel="records"]').innerText.includes('DELIVERY'));

    assert.deepEqual(errors, []);
    await context.close();
    console.log('saved entry month e2e: ok');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
