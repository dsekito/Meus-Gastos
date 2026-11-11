const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

test('calendário mostra entrada e saída simultâneas sem perder área de toque', async () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'mobile.css'), 'utf8');
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const width of [320, 375, 690]) {
      const page = await browser.newPage({ viewport: { width, height: 740 } });
      await page.setContent(`<style>${css}</style><section class="calendar-panel"><div class="calendar-scroll"><div class="calendar-grid">
        <button class="calendar-day has-income" aria-label="Dia 1: entrada 10, saída 0"><span class="calendar-date">1</span></button>
        <button class="calendar-day has-cost" aria-label="Dia 2: entrada 0, saída 10"><span class="calendar-date">2</span></button>
        <button class="calendar-day has-income has-cost" aria-label="Dia 3: entrada 10, saída 10"><span class="calendar-date">3</span></button>
      </div></div></section>`);
      const result = await page.locator('.calendar-day').evaluateAll(days => days.map(day => {
        const rect = day.getBoundingClientRect();
        const date = day.querySelector('.calendar-date').getBoundingClientRect();
        const pseudo = getComputedStyle(day, '::after');
        return { content: pseudo.content, width: rect.width, height: rect.height, dateBottom: date.bottom, dayBottom: rect.bottom, lineHeight: parseFloat(pseudo.lineHeight), label: day.getAttribute('aria-label') };
      }));
      assert.match(result[0].content, /\+/);
      assert.match(result[1].content, /•/);
      assert.match(result[2].content, /\+/);
      assert.match(result[2].content, /•/, `saída deve permanecer visível quando há entrada em ${width}px`);
      for (const day of result) {
        assert.ok(day.width >= 48 && day.height >= 48);
        assert.ok(day.dateBottom + day.lineHeight <= day.dayBottom + 0.1, 'indicador deve caber abaixo da data');
        assert.match(day.label, /entrada.*saída/);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
