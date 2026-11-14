// Larguras de layout: nada passa da tela no celular, as seções dos Ajustes
// usam toda a largura do diálogo e as linhas dos registros mantêm o menu no
// status no canto inferior direito e a linha toda abre o registro. App real em modo
// local, perfil sintético.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const BASE_URL = process.env.MG_BASE_URL || 'http://localhost:8000';

async function openLocalProfile(browser, viewport, entries = []) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.goto(BASE_URL);
  await page.getByRole('button', { name: 'Usar só neste aparelho' }).click();
  await page.waitForSelector('#syncStatus[data-state="local"]');
  await page.evaluate(async (entries) => {
    const { id } = JSON.parse(localStorage.getItem('meus-gastos-local-profile'));
    const current = await MGLocalStore.load(id, { observe: false });
    const today = new Date().toISOString().slice(0, 10);
    await MGLocalStore.compareAndSwap(id, current, {
      ...(current || {}),
      entries: entries.map(entry => ({ ...entry, date: today })),
      settings: { current_balance: 0, balance_reference_date: today, onboarding_status: 'completed' },
    });
  }, entries);
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

    // Linhas dos registros: status no canto inferior direito com 48 px, a linha
    // inteira abre o registro, altura compacta e título sem palavra quebrada.
    const rowEntries = [
      { id: '00000000-0000-4000-8000-000000000001', type: 'ALIMENTAÇÃO', description: 'SUPERMERCADO', detail: 'compra grande do mês com produtos de limpeza', value: 200, paid: false, flow_type: 'expense', created_at: '2026-11-01T10:00:00.000Z' },
      { id: '00000000-0000-4000-8000-000000000002', type: 'RECEITAS', description: 'SALÁRIO', value: 4000, paid: false, flow_type: 'income', created_at: '2026-11-01T10:00:00.000Z' },
    ];
    for (const width of [320, 375, 1280]) {
      const { context, page, errors } = await openLocalProfile(browser, { width, height: 800 }, rowEntries);
      await page.locator('.app-navigation [data-app-destination="records"]').click();
      const rows = await page.evaluate(() => [...document.querySelectorAll('#rows .dense-entry')].map(row => {
        const box = element => element.getBoundingClientRect();
        row.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = box(row), status = box(row.querySelector('.status-button'));
        const title = row.querySelector('.entry-title-text');
        const words = title.textContent.split(/\s+/);
        const corner = document.elementFromPoint(r.left + 6, r.top + 6);
        return {
          height: r.height, titleLines: Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)),
          statusBottom: r.bottom - status.bottom, statusRight: r.right - status.right, statusHeight: status.height,
          cornerOpens: Boolean(corner?.closest('[data-open-entry]')),
          // A word broken in the middle makes the title wider than its longest word allows.
          brokenWord: words.some(word => { const probe = document.createElement('span'); probe.style.cssText = 'position:absolute;white-space:nowrap;font:inherit'; probe.textContent = word; title.append(probe); const wide = probe.getBoundingClientRect().width > title.getBoundingClientRect().width + 1; probe.remove(); return wide; }),
        };
      }));
      for (const row of rows) {
        assert.ok(row.statusBottom <= 8 && row.statusRight <= 8, `${width}: status no canto inferior direito`);
        assert.ok(row.statusHeight >= 48, `${width}: status com 48 px de altura`);
        assert.equal(row.cornerOpens, true, `${width}: a linha toda abre o registro`);
        assert.equal(row.brokenWord, false, `${width}: título sem palavra quebrada`);
        if (width >= 360 && row.titleLines === 1) assert.ok(row.height <= 90, `${width}: linha compacta (${row.height}px)`);
      }
      assert.deepEqual(await overflowing(page), [], `${width}: nada passa da tela`);
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
