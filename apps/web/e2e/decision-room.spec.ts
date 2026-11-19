import { type Page, expect, test } from '@playwright/test';
import {
  type CeoCommand,
  type Command,
  createEngine,
  previewCustomDecision,
  selectAdvisorBrief,
  selectDecision,
  selectMorningReport,
} from '@ceo-room/engine';
import { createTranslator, formatMoneyParts } from '@ceo-room/i18n';
import { loadSeed } from '@ceo-room/seed-data';
import { deltaCell } from '../src/room/impact';

// The same engine the worker runs (seed, rngSeed 42): every expected figure comes from its selectors.
const seed = loadSeed();
const fresh = () => createEngine(seed, { rngSeed: 42, workspaceId: 'ws_desk' });
const DEC = 'dec-0001';
const day1 = fresh().state();
const room = selectDecision(day1, DEC)!;
const tr = createTranslator('tr');
const money = (k: number) => {
  const p = formatMoneyParts(k, 'tr');
  return `${p.value} ${p.unit}`;
};
const horizon = (optionId: string, h: number) => room.impacts!.options.find((o) => o.optionId === optionId)!.horizons.find((x) => x.horizonDays === h)!;

/** Cash in the morning report after `cmds` on Day 1 and a 30-day advance. */
function cashAfter30(cmds: Command[]): number {
  const e = fresh();
  for (const c of cmds) expect(e.dispatch(c).ok).toBe(true);
  e.advance(30);
  return selectMorningReport(e.state(), { includeRunway: false }).cash;
}

async function newGame(page: Page) {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('calendar-day')).toHaveText('1');
}

async function openSteelRoom(page: Page) {
  const tg = page.locator('[data-testid=telegram][data-code="card.supplierPriceIncrease"]');
  await tg.getByRole('button').first().click();
  await tg.getByTestId('telegram-open-room').click();
  await expect(page.getByTestId('option-note')).toHaveCount(3);
}

const scene = (page: Page) => page.getByTestId('desk');

test.describe.configure({ mode: 'serial' });

test('the CEO journey: telegram → Decision Room → seal → Desk and ledger → 30 days later', async ({ page }) => {
  await newGame(page);
  await openSteelRoom(page);
  await expect(scene(page)).toHaveAttribute('data-view', 'room');
  await expect(page.getByTestId('room-name')).toHaveText('Karar Odası');
  await expect(page.getByTestId('tab-room')).toBeVisible();

  // situation: telegram, summary and supporting figures (capped runway prints as "180+")
  await expect(page.getByTestId('room-telegram')).toContainText('Kuzeyçelik Haddecilik A.Ş.');
  await expect(page.getByTestId('situation-text')).toContainText('%20');
  await expect(page.getByTestId('room-figure-figure.cash')).toHaveText(money(day1.cash));
  await expect(page.getByTestId('room-deadline')).toContainText('7 gün');

  // three options as pinned notes (+7 / +30) and the baseline (absorb = reject)
  const notes = page.getByTestId('option-note');
  await expect(notes.nth(0)).toHaveAttribute('data-option', 'negotiate');
  await expect(notes.nth(1)).toHaveAttribute('data-option', 'switch');
  await expect(notes.nth(2)).toHaveAttribute('data-option', 'passOn');
  for (let i = 0; i < 3; i++) await expect(notes.nth(i).getByTestId('impact-horizon')).toHaveCount(2);
  await expect(page.getByTestId('baseline')).toContainText('Zammı üstlen');
  await expect(page.getByTestId('baseline-row')).toHaveCount(2);
  // every row of the spec: cash, margin, delivery, customers, people (overtime, turnover), risk
  const neg = page.locator('[data-option=negotiate]');
  for (const m of ['cash', 'margin', 'delivery', 'satisfaction', 'overtime', 'turnover', 'risk']) {
    await expect(neg.getByTestId(`cell-${m}-7`)).toHaveText(deltaCell(tr, m as never, horizon('negotiate', 7)).text);
    await expect(neg.getByTestId(`cell-${m}-30`)).toHaveText(deltaCell(tr, m as never, horizon('negotiate', 30)).text);
  }
  // the delayed cash effect of negotiating: nothing at +7, lower at +30 (bills of the volume order)
  expect(horizon('negotiate', 7).delta.cash).toBe(0);
  expect(horizon('negotiate', 30).delta.cash).toBeLessThan(horizon('negotiate', 7).delta.cash);
  await expect(neg.getByTestId('cell-cash-7')).toHaveText('0');
  await expect(neg.getByTestId('cell-cash-30')).toHaveText(/^−/);

  // both advisors, signed with the seed's names, with different picks and the CFO's caveats
  const cfo = selectAdvisorBrief(day1, 'cfo', DEC)!;
  const coo = selectAdvisorBrief(day1, 'coo', DEC)!;
  expect(cfo.recommendedOptionId).not.toBe(coo.recommendedOptionId);
  await expect(page.getByTestId('advisor-cfo')).toHaveAttribute('data-recommends', cfo.recommendedOptionId);
  await expect(page.getByTestId('advisor-coo')).toHaveAttribute('data-recommends', coo.recommendedOptionId);
  await expect(page.getByTestId('advisor-cfo').getByTestId('advisor-signature')).toHaveText('— Ayşe Kaya, CFO');
  await expect(page.getByTestId('advisor-coo').getByTestId('advisor-signature')).toContainText(coo.advisorName);
  const deferred = cfo.deferred[0]!;
  await expect(page.getByTestId('advisor-cfo').getByTestId('advisor-caveats')).toContainText(money(deferred.amount));
  await expect(page.getByTestId('advisor-cfo').getByTestId('advisor-caveats')).toContainText(`Gün ${deferred.firstDueDay}`);
  await expect(page.getByTestId('advisor-cfo').getByTestId('advisor-caveats')).toContainText('90 gün ileriye');

  // the seal needs a chosen option; then it approves it
  await page.getByTestId('approve-seal').click();
  await expect(page.getByTestId('room-status')).toContainText('bir seçenek seçin');
  await neg.getByTestId('choose-option').click();
  await expect(neg).toHaveAttribute('data-selected', 'true');
  await page.getByTestId('approve-seal').click();

  // back on the Desk: the decision is gone, its telegram filed, the ledger's carbon copy is open
  await expect(scene(page)).toHaveAttribute('data-view', 'desk');
  await expect(page.getByTestId('tab-room')).toHaveCount(0);
  await expect(page.getByTestId('decision-folder')).toHaveCount(0);
  await expect(page.locator('[data-testid=telegram][data-code="card.supplierPriceIncrease"]')).toHaveCount(0);
  const sheet = page.getByTestId('ledger-sheet');
  await expect(sheet.getByTestId('ledger-sheet-title')).toHaveText('1 numaralı karar onaylandı: Tedarikçiyle pazarlık et');
  await expect(sheet.locator('[data-code="ledger.DecisionResolved"]')).toContainText('onaylandı');
  await expect(sheet.locator('[data-code="ledger.SupplierPriceChanged"]')).toHaveCount(1);
  await expect(sheet.locator('[data-code="ledger.PurchaseOrderPlaced"]').first()).toBeVisible();
  await expect(sheet.getByTestId('ledger-cause').first()).toHaveText('← talimatınız: seçenek onayı');
  // records are named as the CEO knows them, never by raw id
  await expect(sheet).not.toContainText(/\b(dec|cmd|ord|po|pay|rcv|dev)-\d/);
  await expect(sheet.locator('[data-code="ledger.DecisionResolved"]')).toContainText('No. 1 kararı');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('ledger-slip-title')).toHaveText('1 numaralı karar onaylandı: Tedarikçiyle pazarlık et');

  // 30 days later the morning report shows the engine's figures for this decision, not a no-decision run
  await page.getByTestId('advance-month').click();
  await expect(page.getByTestId('calendar-day')).toHaveText('31', { timeout: 30_000 });
  const decided = cashAfter30([{ type: 'approveOption', decisionId: DEC, optionId: 'negotiate' }]);
  const untouched = cashAfter30([]);
  expect(decided).not.toBe(untouched);
  // relative to the baseline, Negotiate's cash is lower at +30 than at +7 (the delayed effect)
  expect(decided - untouched).toBe(horizon('negotiate', 30).delta.cash);
  await expect(page.getByTestId('report-cash-value')).toHaveText(money(decided));
  await expect(page.getByTestId('report-cash-value')).not.toHaveText(money(untouched));
});

test('the seal is sent at the press: trying to leave for the Desk at once cannot drop it', async ({ page }) => {
  await newGame(page);
  await openSteelRoom(page);
  await page.locator('[data-option=switch]').getByTestId('choose-option').click();
  await page.getByTestId('approve-seal').click();
  // while the decision is being sent the tabs wait (aria-disabled); a click on the Desk tab does nothing
  await expect(page.getByTestId('tab-desk')).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('tab-desk').click({ force: true });
  // the decision is taken all the same, and its carbon copy is on the Desk
  await expect(scene(page)).toHaveAttribute('data-view', 'desk');
  await expect(page.getByTestId('decision-folder')).toHaveCount(0);
  await expect(page.getByTestId('ledger-sheet-title')).toHaveText('1 numaralı karar onaylandı: Alternatif tedarikçiye geç');
});

test('keyboard: focus lands on the options, stays on the pressed seal, and returns to the Desk', async ({ page }) => {
  await newGame(page);
  const tg = page.locator('[data-testid=telegram][data-code="card.supplierPriceIncrease"]');
  await tg.getByRole('button').first().focus();
  await page.keyboard.press('Enter');
  await tg.getByTestId('telegram-open-room').focus();
  await page.keyboard.press('Enter');
  // the room opens with focus on its options, not on nothing
  await expect(page.locator('#options-heading')).toBeFocused();
  await page.locator('[data-option=negotiate]').getByTestId('choose-option').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-option=negotiate]')).toHaveAttribute('data-selected', 'true');
  await page.getByTestId('approve-seal').focus();
  await page.keyboard.press('Enter');
  // pressed: the seal keeps focus (aria-disabled, not disabled) while the decision is sent
  await expect(page.getByTestId('approve-seal')).toBeFocused();
  // the room closes: the carbon copy has focus; put away, focus goes to its slip on the Desk
  await expect(scene(page)).toHaveAttribute('data-view', 'desk');
  await expect(page.getByTestId('ledger-sheet').getByRole('button', { name: 'Kapat' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ledger-slip')).toBeFocused();
});

test('keyboard: a room put back from a closed decision gives focus to its carbon copy on the Desk', async ({ page }) => {
  await newGame(page);
  await openSteelRoom(page);
  await page.getByTestId('tab-desk').click();
  // the deadline passes with the room behind its tab
  await page.getByTestId('advance-week').click();
  await expect(page.getByTestId('calendar-day')).toHaveText('8', { timeout: 30_000 });
  await page.getByTestId('tab-room').click();
  await expect(page.getByTestId('room-closed')).toBeVisible();
  await page.getByRole('button', { name: 'Masaya dön' }).focus();
  await page.keyboard.press('Enter');
  await expect(scene(page)).toHaveAttribute('data-view', 'desk');
  await expect(page.getByTestId('ledger-slip')).toHaveAttribute('data-decision', DEC);
  await expect(page.getByTestId('ledger-slip')).toBeFocused();
});

test('reject stamps the decision and runs the default option', async ({ page }) => {
  await newGame(page);
  await openSteelRoom(page);
  await page.getByTestId('reject').click();
  await expect(scene(page)).toHaveAttribute('data-view', 'desk');
  await expect(page.getByTestId('decision-folder')).toHaveCount(0);
  await expect(page.getByTestId('ledger-sheet-title')).toHaveText('1 numaralı karar reddedildi: Zammı üstlen');
  await page.getByTestId('ledger-sheet').getByRole('button', { name: 'Kapat' }).click();
  await expect(page.getByTestId('ledger-slip')).toContainText('reddedildi');
});

test('more analysis stays open, is ready next morning and adds the +90 column', async ({ page }) => {
  await newGame(page);
  await openSteelRoom(page);
  await page.getByTestId('request-analysis').click();
  await expect(page.getByTestId('analysis-tab')).toHaveText('Analiz Gün 2 sabahı hazır');
  // the button gives way to its tab, and focus follows it
  await expect(page.getByTestId('analysis-tab')).toBeFocused();
  await expect(page.getByTestId('room-status')).toContainText('Gün 2 sabahı');
  await expect(scene(page)).toHaveAttribute('data-view', 'room');
  await expect(page.getByTestId('impact-horizon')).toHaveCount(6);

  // back to the Desk (tab), ring the bell, return: the room shows Day 2's figures with +90
  await page.getByTestId('tab-desk').click();
  await expect(page.getByTestId('decision-folder')).toHaveCount(1);
  await page.getByTestId('desk-bell').click();
  await expect(page.getByTestId('calendar-day')).toHaveText('2');
  await page.getByTestId('tab-room').click();
  await expect(page.getByTestId('analysis-tab')).toHaveText('Analiz hazır: +90 gün eklendi');
  await expect(page.locator('[data-option=negotiate]').getByTestId('impact-horizon')).toHaveCount(3);
  await expect(page.locator('[data-option=negotiate]').getByTestId('impact-horizon').nth(2)).toContainText('+90 gün');
  await expect(page.getByTestId('baseline-row')).toHaveCount(3);
  // the figures are Day 2's: +7 lands on Day 9
  await expect(page.locator('[data-option=negotiate]').getByTestId('impact-horizon').first()).toContainText('Gün 9');
  const e = fresh();
  e.dispatch({ type: 'requestAnalysis', decisionId: DEC });
  e.advance(1);
  const ext = selectDecision(e.state(), DEC)!.analysis!.extended!;
  const h90 = ext.options.find((o) => o.optionId === 'switch')!.horizons.find((h) => h.horizonDays === 90)!;
  await expect(page.locator('[data-option=switch]').getByTestId('cell-cash-90')).toHaveText(deltaCell(tr, 'cash', h90).text);
});

test('a custom decision memo is previewed by the engine and sealed', async ({ page }) => {
  await newGame(page);
  await openSteelRoom(page);
  await page.getByTestId('open-memo').click();
  const memo = page.getByTestId('memo');
  await expect(memo).toBeVisible();
  // a decimal is never read as a larger whole number ("2.5" is not 25)
  for (const bad of ['2.5', '1,5', '0.5', '12.34.5']) {
    await memo.getByTestId('memo-qty').fill(bad);
    await expect(memo.getByTestId('memo-error')).toContainText('tam sayı');
    await expect(memo.getByTestId('memo-qty-read')).toHaveCount(0);
    await expect(memo.getByTestId('memo-preview-button')).toBeDisabled();
  }
  // grouped thousands are read as typed, and the reading is shown before any preview
  await memo.getByTestId('memo-qty').fill('12.500');
  await expect(memo.getByTestId('memo-qty-read')).toHaveText('Okunan: 12.500 birim çelik');
  await expect(memo.getByTestId('memo-error')).toHaveCount(0);
  // a line with an out-of-range number is caught before the engine is asked
  await memo.getByTestId('memo-qty').fill('0');
  await expect(memo.getByTestId('memo-error')).toContainText('1 ile 10.000.000');
  await expect(memo.getByTestId('memo-preview-button')).toBeDisabled();
  await memo.getByTestId('memo-qty').fill('2000');
  await memo.getByTestId('memo-add-kind').selectOption('repriceOrders');
  await memo.getByTestId('memo-add').click();
  await memo.getByTestId('memo-pass').fill('50');
  await expect(memo.getByTestId('memo-seal')).toBeDisabled();
  await memo.getByTestId('memo-preview-button').click();

  const cmds: CeoCommand[] = [
    { type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 2000 },
    { type: 'repriceOrders', materialId: 'steel', passThroughBps: 5000 },
  ];
  const p = previewCustomDecision(day1, DEC, cmds)!;
  const at = (h: number) => p.impact.horizons.find((x) => x.horizonDays === h)!;
  const impact = memo.getByTestId('memo-impact');
  await expect(impact.getByTestId('impact-horizon')).toHaveCount(2);
  for (const m of ['cash', 'margin', 'satisfaction', 'risk'] as const) {
    await expect(impact.getByTestId(`cell-${m}-7`)).toHaveText(deltaCell(tr, m, at(7)).text);
    await expect(impact.getByTestId(`cell-${m}-30`)).toHaveText(deltaCell(tr, m, at(30)).text);
  }
  // changing the memo after the preview asks for a new preview before sealing
  await memo.getByTestId('memo-pass').fill('40');
  await expect(memo.getByTestId('memo-seal')).toBeDisabled();
  await memo.getByTestId('memo-pass').fill('50');
  await memo.getByTestId('memo-preview-button').click();
  await expect(memo.getByTestId('memo-seal')).toBeEnabled();
  await memo.getByTestId('memo-seal').click();

  await expect(scene(page)).toHaveAttribute('data-view', 'desk');
  await expect(page.getByTestId('ledger-sheet-title')).toHaveText('1 numaralı karar onaylandı: özel not');
  await expect(page.getByTestId('ledger-sheet').locator('[data-code="ledger.OrderRepriced"]').first()).toBeVisible();
  // the state is the engine's after the same custom decision
  await page.keyboard.press('Escape');
  await page.getByTestId('advance-week').click();
  await expect(page.getByTestId('calendar-day')).toHaveText('8', { timeout: 30_000 });
  const e = fresh();
  e.dispatch({ type: 'customDecision', decisionId: DEC, commands: cmds });
  e.advance(7);
  await expect(page.getByTestId('report-cash-value')).toHaveText(money(e.state().cash));
});

test('the room opens from a folder via the dossier; the Desk tab keeps it; numbers follow the day', async ({ page }) => {
  await newGame(page);
  await page.getByTestId('decision-folder').first().click();
  await page.getByTestId('dossier-open-room').click();
  await expect(scene(page)).toHaveAttribute('data-view', 'room');
  await expect(page.locator('[data-option=negotiate]').getByTestId('impact-horizon').first()).toContainText('Gün 8');
  // keyboard: the Desk tab is reachable and works with Enter
  await page.getByTestId('tab-desk').focus();
  await page.keyboard.press('Enter');
  await expect(scene(page)).toHaveAttribute('data-view', 'desk');
  await page.getByTestId('desk-bell').click();
  await expect(page.getByTestId('calendar-day')).toHaveText('2');
  await page.getByTestId('tab-room').click();
  // a view for Day 1 is never shown on Day 2: +7 now lands on Day 9
  await expect(page.locator('[data-option=negotiate]').getByTestId('impact-horizon').first()).toContainText('Gün 9');
  await expect(page.getByTestId('room-deadline')).toContainText('6 gün');
});

test('in English the room reads in English', async ({ page }) => {
  await newGame(page);
  await page.getByRole('button', { name: 'English' }).click();
  await openSteelRoom(page);
  await expect(page.getByTestId('room-name')).toHaveText('Decision Room');
  await expect(page.getByTestId('baseline')).toContainText('Absorb the increase');
  await expect(page.getByTestId('advisor-cfo').getByTestId('advisor-signature')).toHaveText('— Ayşe Kaya, CFO');
  await expect(page.getByTestId('approve-seal')).toContainText('Approve');
});

test('at the smallest scale (1280×700) the room, the memo and the carbon copy stay legible', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await newGame(page);
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
      const controls = [...scene.querySelectorAll('button, select, input')].filter((b) => b.getClientRects().length > 0);
      const tiny = controls
        .map((b) => ({ name: b.getAttribute('aria-label') ?? b.textContent ?? b.id, r: b.getBoundingClientRect() }))
        .filter(({ r }) => r.width < 44 || r.height < 44)
        .map(({ name, r }) => `${name}: ${Math.round(r.width)}×${Math.round(r.height)}`);
      return { scale, small, tiny };
    });
  await openSteelRoom(page);
  await expect(page.getByTestId('advisor-coo')).toBeVisible();
  const roomView = await measure();
  expect(roomView.scale).toBeCloseTo(0.78, 2);
  expect(roomView.small).toEqual([]);
  expect(roomView.tiny).toEqual([]);

  await page.getByTestId('open-memo').click();
  await page.getByTestId('memo-qty').fill('100');
  await page.getByTestId('memo-preview-button').click();
  await expect(page.getByTestId('memo-impact')).toBeVisible();
  const memoView = await measure();
  expect(memoView.small).toEqual([]);
  expect(memoView.tiny).toEqual([]);
  await page.keyboard.press('Escape');

  await page.locator('[data-option=switch]').getByTestId('choose-option').click();
  await page.getByTestId('approve-seal').click();
  await expect(page.getByTestId('ledger-sheet')).toBeVisible();
  const ledgerView = await measure();
  expect(ledgerView.small).toEqual([]);
  expect(ledgerView.tiny).toEqual([]);
});
