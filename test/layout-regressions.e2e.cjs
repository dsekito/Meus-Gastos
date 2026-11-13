// Larguras de layout: nada passa da tela no celular e as seções dos Ajustes
// usam toda a largura do diálogo. App real em modo local, perfil sintético.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const BASE_URL = process.env.MG_BASE_URL || 'http://localhost:8000';

async function openLocalProfile(browser, viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.goto(BASE_URL);
  await page.getByRole('button', { name: 'Usar só neste aparelho' }).click();
  await page.waitForSelector('#syncStatus[data-state="local"]');
  await page.evaluate(async () => {
    const { id } = JSON.parse(localStorage.getItem('meus-gastos-local-profile'));
    const current = await MGLocalStore.load(id, { observe: false });
    const today = new Date().toISOString().slice(0, 10);
    await MGLocalStore.compareAndSwap(id, current, {
      ...(current || {}),
      settings: { current_balance: 0, balance_reference_date: today, onboarding_status: 'completed' },
    });
  });
  await page.reload();
  await page.waitForSelector('#syncStatus[data-state="local"]');
  return { context, page, errors };
}

const overflowing = page => page.evaluate(() => {
  const width = document.documentElement.clientWidth;
  return [...document.querySelectorAll('body *')]
    .filter(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.right > width + 1 && getComputedStyle(element).visibility !== 'hidden';
    })
    .map(element => element.id || element.className || element.tagName);
});

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    // Modo local no celular: o botão "Conectar Google" mostra só o ícone e
    // mantém o nome acessível, sem empurrar a página para os lados.
    for (const width of [320, 375, 412]) {
      const { context, page, errors } = await openLocalProfile(browser, { width, height: 700 });
      assert.deepEqual(await overflowing(page), [], `nada passa de ${width} px`);
      const connect = page.getByRole('button', { name: 'Conectar sua conta Google para sincronizar' });
      const box = await connect.boundingBox();
      assert.ok(box.width >= 48 && box.height >= 48, 'área de toque de 48 px');
      assert.deepEqual(errors, []);
      await context.close();
    }

    // Desktop: cada seção dos Ajustes ocupa as duas colunas do diálogo.
    {
      const { context, page, errors } = await openLocalProfile(browser, { width: 1280, height: 800 });
      for (const topic of ['projection', 'options', 'data']) {
        await page.evaluate(name => {
          const dialog = document.querySelector('#settingsDialog');
          if (dialog.open) dialog.close();
          document.querySelector(`[data-settings-topic="${name}"]`).click();
        }, topic);
        const [group, grid] = await page.evaluate(() => {
          const visible = [...document.querySelectorAll('#settingsDialog .settings-group')].find(element => !element.hidden);
          const box = element => element.getBoundingClientRect();
          const gridBox = box(visible.parentElement);
          const style = getComputedStyle(visible.parentElement);
          return [box(visible).width, gridBox.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)];
        });
        assert.ok(Math.abs(group - grid) <= 1, `${topic}: seção com ${group} px numa grade de ${grid} px`);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('layout regressions e2e: ok');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
