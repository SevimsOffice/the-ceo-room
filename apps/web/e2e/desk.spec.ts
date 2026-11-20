import { type Page, expect, test } from '@playwright/test';
import { createEngine, selectMorningReport, selectProjectedRunway } from '@ceo-room/engine';
import { formatBps, formatMoneyParts, formatScorePercent } from '@ceo-room/i18n';
import { loadSeed } from '@ceo-room/seed-data';

// The same engine the worker runs (seed, rngSeed 42): expected figures come from its selectors.
const engine = createEngine(loadSeed(), { rngSeed: 42, workspaceId: 'ws_desk' });
const day1 = selectMorningReport(engine.state(), { includeRunway: false });
const day1Runway = selectProjectedRunway(engine.state());
const money = (k: number, l: 'tr' | 'en') => {
  const p = formatMoneyParts(k, l);
  return `${p.value} ${p.unit}`;
};

test.describe.configure({ mode: 'serial' });

/**
 * Put a save game in the browser behind the app's back. Only once the app has stored its own first
 * save: that save is posted by the engine worker after the page has loaded, and written after ours
 * it would replace it (the reload would then restore a good game and show no slip).
 */
async function plantSave(page: Page, save: unknown): Promise<string> {
  await page.goto('./');
  await expect(page.getByTestId('calendar-day')).toHaveText('1');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ceo-room.save.v1'))).not.toBeNull();
  const text = JSON.stringify(save);
  await page.evaluate((v) => localStorage.setItem('ceo-room.save.v1', v), text);
  return text;
}

test('the CEO journey: report, bell, week, month, language and save', async ({ page }) => {
  await page.goto('./');

  // loads in Turkish with the engine's Day 1 figures
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await expect(page.getByRole('heading', { name: 'Sabah Raporu' })).toBeVisible();
  await expect(page.getByTestId('report-dateline')).toHaveText('Gün 1 · Pazartesi · Genel Müdür için');
  await expect(page.getByTestId('report-revenue-value')).toHaveText(money(day1.revenue.lastPeriod!, 'tr'));
  await expect(page.getByTestId('report-cash-value')).toHaveText(money(day1.cash, 'tr'));
  await expect(page.getByTestId('report-orders-value')).toContainText(String(day1.backlog.openOrders));
  await expect(page.getByTestId('report-orders-value')).toContainText(money(day1.backlog.value, 'tr'));
  await expect(page.getByTestId('report-satisfaction-value')).toHaveText(formatScorePercent(day1.satisfaction.average, 'tr'));
  await expect(page.getByTestId('report-capacity-value')).toHaveText(formatBps(day1.capacityUtilisationBps, 'tr'));
  await expect(page.getByTestId('gauge-capacity-value')).toHaveText(formatBps(day1.capacityUtilisationBps, 'tr'));
  // Day 1 storyline: two telegrams (big order, steel price) and the steel decision folder
  await expect(page.getByTestId('telegram')).toHaveCount(2);
  await expect(page.getByTestId('decision-folder')).toHaveCount(1);

  // the projected runway fills in after the report (computed in the worker)
  await expect(page.getByTestId('gauge-runway-value')).toHaveText(`${day1Runway.days} gün`);
  await expect(page.getByTestId('report-cash-note')).toHaveText(`öngörülen nakit süresi: ${day1Runway.days} gün`);
  await expect(page.getByTestId('report-health-value')).toContainText('/ 100');

  // ring the bell → Day 2
  await page.getByTestId('desk-bell').click();
  await expect(page.getByTestId('calendar-day')).toHaveText('2');
  await expect(page.getByTestId('header-day')).toHaveText('Gün 2 · Salı');
  await expect(page.getByTestId('gauge-runway-value')).not.toHaveText('hesaplanıyor…');

  // +1 week → Day 9: the key account's discount demand arrives
  await page.getByTestId('advance-week').click();
  await expect(page.getByTestId('calendar-day')).toHaveText('9');
  await expect(page.locator('[data-testid=telegram][data-code="card.discountDemand"]')).toHaveCount(1);
  await expect(page.getByTestId('decision-folder')).toHaveCount(1);

  // +1 month → Day 39: the Plant 2 press line breakdown (Day 16) is on the desk
  await page.getByTestId('advance-month').click();
  await expect(page.getByTestId('advance-week')).toBeDisabled();
  await expect(page.getByTestId('calendar-day')).toHaveText('39', { timeout: 30_000 });
  await expect(page.locator('[data-testid=telegram][data-code="card.machineBreakdown"]')).toHaveCount(1);
  await expect(page.locator('[data-testid=telegram][data-code="card.machineBreakdown"]')).toContainText('Gemlik pres hattı arızalandı');
  await expect(page.getByTestId('advance-week')).toBeEnabled();

  // reading a telegram files it as read (engine command)
  const breakdown = page.locator('[data-testid=telegram][data-code="card.machineBreakdown"]');
  await breakdown.getByRole('button').first().click();
  await expect(breakdown).toHaveAttribute('data-status', 'read');

  // switch to English, reload: still English, still Day 39 (saved game restored)
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Morning Report' })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByTestId('calendar-day')).toHaveText('39');
  await expect(page.getByTestId('report-dateline')).toContainText('Day 39');
  await expect(breakdown).toHaveAttribute('data-status', 'read');
  await expect(page.getByTestId('gauge-runway-value')).toHaveText(/\d+\+? days?/);
});

test('order book shows live figures with the plan where they differ', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('calendar-day')).toHaveText('1');
  await page.getByTestId('advance-month').click();
  await expect(page.getByTestId('calendar-day')).toHaveText('31', { timeout: 30_000 });
  await page.getByTestId('report-orders').click();
  const sheet = page.getByTestId('order-book');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('order-row').first()).toBeVisible();
  await expect(sheet.locator('[data-differs="true"]').first()).toContainText(/plan .+ → şimdi /);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});

test('folders open a read-only dossier; pause interrupts a jump; new game asks first', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('calendar-day')).toHaveText('1');

  await expect(page.getByTestId('gauge-runway-value')).toHaveText(/\d/);
  await page.getByTestId('decision-folder').first().click();
  const dossier = page.getByTestId('dossier');
  await expect(dossier.getByTestId('dossier-options').locator('li')).toHaveCount(4);
  // the dossier prints the same live runway as the report (capped as "180+ gün")
  await expect(dossier.getByTestId('dossier-runway-value')).toHaveText((await page.getByTestId('gauge-runway-value').textContent())!);
  await expect(dossier.getByTestId('dossier-room-note')).toContainText('Karar Odası');
  await dossier.getByRole('button', { name: 'Kapat' }).click();
  await expect(dossier).toHaveCount(0);

  await page.getByTestId('advance-month').click();
  await expect(page.getByTestId('calendar-day')).not.toHaveText('1');
  await page.getByTestId('play-pause').click();
  await expect(page.getByTestId('advance-month')).toBeEnabled();
  const stoppedAt = Number(await page.getByTestId('calendar-day').textContent());
  expect(stoppedAt).toBeLessThan(31);
  await page.waitForTimeout(500);
  await expect(page.getByTestId('calendar-day')).toHaveText(String(stoppedAt));

  await page.getByRole('button', { name: 'Yeni oyun' }).click();
  await page.getByTestId('confirm-new-game-yes').click();
  await expect(page.getByTestId('calendar-day')).toHaveText('1');
});

test('below 1280 px wide the office asks for a larger screen', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Masaüstünde görüntüleyin' })).toBeVisible();
});

test('a saved game that cannot be replayed starts a new game and says so', async ({ page }) => {
  await plantSave(page, { format: 1, seedVersion: 999, rngSeed: 42, workspaceId: 'ws_desk', log: [] });
  const old = await page.evaluate(() => localStorage.getItem('ceo-room.save.v1'));
  expect(old).toContain('"seedVersion":999');
  await page.reload();
  await expect(page.getByTestId('calendar-day')).toHaveText('1');
  const slip = page.getByTestId('status-slip');
  await expect(slip).toContainText('Kayıtlı oyun yüklenemedi');
  await expect(slip).toContainText('yedek olarak saklandı');
  // the old save is kept in the backup key; the new game has its own save
  expect(await page.evaluate(() => localStorage.getItem('ceo-room.save.v1.bak'))).toBe(old);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ceo-room.save.v1') ?? '{}').log)).toEqual([]);
  await slip.getByRole('button').click();
  await expect(slip).toHaveCount(0);
});

test('a save with a malformed log entry opens a new game, never an endless loading screen', async ({ page }) => {
  await plantSave(page, { format: 1, seedVersion: 1, rngSeed: 42, workspaceId: 'ws_desk', log: [null] });
  await page.reload();
  await expect(page.getByTestId('calendar-day')).toHaveText('1');
  await expect(page.getByTestId('loading')).toHaveCount(0);
  await expect(page.getByTestId('status-slip')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('ceo-room.save.v1.bak'))).toContain('"log":[null]');
});

test('a double-click on the bell advances exactly one day', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('calendar-day')).toHaveText('1');
  await page.getByTestId('desk-bell').dblclick();
  await expect(page.getByTestId('calendar-day')).toHaveText('2');
  await expect(page.getByTestId('desk-bell')).toBeEnabled();
  await page.waitForTimeout(600);
  await expect(page.getByTestId('calendar-day')).toHaveText('2');
});

test('at 1280×720 the bell, dial, language and new-game controls are at least 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('./');
  await expect(page.getByTestId('calendar-day')).toBeVisible();
  const controls = [
    page.getByTestId('desk-bell'),
    page.getByTestId('advance-week'),
    page.getByTestId('advance-month'),
    page.getByTestId('play-pause'),
    page.getByRole('button', { name: 'Türkçe' }),
    page.getByRole('button', { name: 'English' }),
    page.getByTestId('new-game'),
  ];
  for (const c of controls) {
    const box = (await c.boundingBox())!;
    expect(box.width, await c.getAttribute('aria-label') ?? '').toBeGreaterThanOrEqual(44);
    expect(box.height, await c.getAttribute('aria-label') ?? '').toBeGreaterThanOrEqual(44);
  }
  // play / pause is a drawn glyph, named by the button
  await expect(page.getByTestId('play-pause').getByTestId('play-glyph')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByTestId('play-pause')).toHaveAttribute('aria-label', /Oynat/);
  // the calendar's day number is typed (Courier Prime), like every figure
  expect(await page.getByTestId('calendar-day').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Courier Prime');
});

test('at the smallest scale (1280×700) every control is ≥ 44 px and every text ≥ 12 px on screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('gauge-runway-value')).toHaveText(/\d/);
  const measure = () =>
    page.evaluate(() => {
      const scene = document.querySelector<HTMLElement>('[data-testid=scene]')!;
      const scale = Number(/scale\(([\d.]+)\)/.exec(scene.style.transform)![1]);
      const small: string[] = [];
      for (const el of scene.querySelectorAll<HTMLElement>('*')) {
        if (el.closest('.sr-only') || el.closest('svg') || el.getClientRects().length === 0) continue;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
        const px = parseFloat(getComputedStyle(el).fontSize) * scale;
        if (px < 12) small.push(`${px.toFixed(1)}px "${el.textContent!.trim().slice(0, 30)}"`);
      }
      const tiny = [...scene.querySelectorAll('button')]
        .filter((b) => b.getClientRects().length > 0)
        .map((b) => ({ name: b.getAttribute('aria-label') ?? b.textContent, r: b.getBoundingClientRect() }))
        .filter(({ r }) => r.width < 44 || r.height < 44)
        .map(({ name, r }) => `${name}: ${Math.round(r.width)}×${Math.round(r.height)}`);
      return { scale, small, tiny };
    });
  const desk = await measure();
  expect(desk.scale).toBeCloseTo(0.78, 2);
  expect(desk.small).toEqual([]);
  expect(desk.tiny).toEqual([]);

  // the sheets laid over the desk follow the same floor
  await page.getByTestId('decision-folder').first().click();
  await expect(page.getByTestId('dossier-runway-value')).toHaveText(/\d/);
  const dossier = await measure();
  expect(dossier.small).toEqual([]);
  expect(dossier.tiny).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByTestId('report-orders').click();
  await expect(page.getByTestId('order-row').first()).toBeVisible();
  const book = await measure();
  expect(book.small).toEqual([]);
  expect(book.tiny).toEqual([]);
});

test('when the engine worker cannot start, an error slip offers a new game that works', async ({ page }) => {
  await plantSave(page, { format: 1, seedVersion: 1, rngSeed: 42, workspaceId: 'ws_desk', log: [] });
  await page.route('**/engine.worker-*.js', (route) => route.abort());
  await page.reload();
  const slip = page.getByTestId('fatal-slip');
  await expect(slip).toBeVisible();
  await expect(slip).toContainText('Masa açılamadı');
  await expect(page.getByTestId('loading')).toHaveCount(0);

  await page.unroute('**/engine.worker-*.js');
  await slip.getByTestId('fatal-new-game').click();
  await expect(slip).toHaveCount(0);
  await expect(page.getByTestId('calendar-day')).toHaveText('1');
  // the save that was on file is kept as the backup
  expect(await page.evaluate(() => localStorage.getItem('ceo-room.save.v1.bak'))).toContain('"seedVersion":1');
});
