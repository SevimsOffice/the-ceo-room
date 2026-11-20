import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import type { Workbook } from '@ceo-room/import';
import { workbookToXlsx, xlsxToWorkbook } from '../src/xlsx/xlsx';

/**
 * The Archive Room (M4a): template download → upload → inspection report → import as My company,
 * the user's acceptance test (NOVARA's own template imported runs exactly like NOVARA), broken and
 * unreadable files, the company switch, removal, no network at all, legibility and fit.
 */

test.describe.configure({ mode: 'serial' });

const ORIGIN = 'http://localhost:4173';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A clean browser: no saves, no My company. */
async function clean(page: Page) {
  await page.goto('./');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase('ceo-room');
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  });
  await page.reload();
  await expect(page.getByTestId('calendar-day')).toHaveText('1');
}

/** Every figure of the morning report and the gauges, once the runway has been computed. */
async function figures(page: Page): Promise<Record<string, string>> {
  await expect(page.getByTestId('gauge-runway-value')).toHaveText(/\d/);
  const out: Record<string, string> = {};
  for (const id of ['revenue', 'cash', 'orders', 'satisfaction', 'capacity', 'health', 'turnover']) {
    out[id] = (await page.getByTestId(`report-${id}-value`).textContent())!;
    out[`${id}-note`] = (await page.getByTestId(`report-${id}-note`).textContent())!;
  }
  out.capacityGauge = (await page.getByTestId('gauge-capacity-value').textContent())!;
  out.runwayGauge = (await page.getByTestId('gauge-runway-value').textContent())!;
  out.telegrams = String(await page.getByTestId('telegram').count());
  out.folders = String(await page.getByTestId('decision-folder').count());
  return out;
}

async function toArchive(page: Page) {
  await page.getByTestId('tab-archive').click();
  await expect(page.getByTestId('archive-room')).toBeVisible();
}

async function toDesk(page: Page) {
  await page.getByTestId('tab-desk').click();
  await expect(page.getByTestId('calendar-day')).toBeVisible();
}

/** Download a template from the pigeonhole; returns the saved file's path. */
async function downloadTemplate(page: Page, kind: 'example' | 'empty', path: string): Promise<string> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId(`download-${kind}`).click()]);
  await dl.saveAs(path);
  return path;
}

/** Choose a file on the blotter (a path is sent as its bytes: paths with non-ASCII letters do not reach the browser). */
async function upload(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  const payload = typeof file === 'string' ? { name: basename(file), mimeType: XLSX, buffer: readFileSync(file) } : file;
  await page.getByTestId('file-input').setInputFiles(payload);
}

async function importExample(page: Page, path: string) {
  await toArchive(page);
  await downloadTemplate(page, 'example', path);
  await upload(page, path);
  await expect(page.getByTestId('inspection-report')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByTestId('import-button')).toBeEnabled();
  await page.getByTestId('import-button').click();
  await expect(page.getByTestId('archive-note')).toHaveAttribute('data-tone', 'ok');
  await expect(page.getByTestId('switch-mine')).toHaveAttribute('aria-pressed', 'true');
}

async function brokenFile(from: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const wb: Workbook = await xlsxToWorkbook(readFileSync(from));
  const set = (sheet: string, row: number, key: string, v: string) => {
    wb[sheet]![row - 1]![wb[sheet]![0]!.indexOf(key)] = v;
  };
  // a customer code that does not exist, and an e-mail address where a company name belongs
  set('OpenOrders', 7, 'customer_id', 'C-9999');
  set('Customers', 5, 'name', 'satis@ornek.com.tr');
  const blob = await workbookToXlsx(wb);
  return { name: 'bozuk.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await blob.arrayBuffer()) };
}

test('acceptance: the NOVARA template downloaded, uploaded and imported as My company runs exactly like NOVARA', async ({ page }, info) => {
  test.setTimeout(150_000);
  await clean(page);
  const novaraDay1 = await figures(page);
  await expect(page.getByTestId('header-forecast')).toHaveCount(0);

  await importExample(page, info.outputPath('novara.xlsx'));
  await expect(page.getByTestId('count-errors')).toHaveText('0 hata');
  await expect(page.getByTestId('register-mine')).toContainText('novara.xlsx');
  await expect(page.getByTestId('register-mine')).toContainText('1. gün 04.01.2027');

  // My company on the desk: the real snapshot date on Day 1, the same figures as NOVARA's Day 1
  await toDesk(page);
  await expect(page.getByTestId('header-day')).toHaveText('4 Ocak 2027 · Pazartesi');
  await expect(page.getByTestId('calendar-label')).toHaveText('Ocak 2027');
  await expect(page.getByTestId('calendar-day')).toHaveText('4');
  await expect(page.getByTestId('report-dateline')).toHaveText('4 Ocak 2027 · Pazartesi · Genel Müdür için');
  await expect(page.getByTestId('report-company')).toHaveText('NOVARA Sanayi');
  await expect(page.getByTestId('report-stamp')).toHaveText('Dosyanızdan');
  await expect(page.getByTestId('header-forecast')).toHaveCount(0);
  expect(await figures(page)).toEqual(novaraDay1);

  // a week later: a forecast, labelled on the header, the calendar and the report
  await page.getByTestId('advance-week').click();
  await expect(page.getByTestId('calendar-day')).toHaveText('11', { timeout: 30_000 });
  await expect(page.getByTestId('header-day')).toHaveText('11 Ocak 2027 · Pazartesi');
  await expect(page.getByTestId('header-forecast')).toContainText('Tahmin');
  await expect(page.getByTestId('calendar-forecast')).toHaveText('TAHMİN');
  await expect(page.getByTestId('report-forecast')).toHaveText('Tahmin · 4 Ocak 2027 anlık görüntüsünden');
  await expect(page.getByTestId('report-stamp')).toHaveText('Tahmin');
  const mineDay8 = await figures(page);

  // NOVARA kept its own day: still Day 1; the same week gives the same figures
  await toArchive(page);
  await page.getByTestId('switch-sample').click();
  await expect(page.getByTestId('switch-sample')).toHaveAttribute('aria-pressed', 'true');
  await toDesk(page);
  await expect(page.getByTestId('calendar-day')).toHaveText('1');
  await expect(page.getByTestId('header-day')).toHaveText('Gün 1 · Pazartesi');
  await page.getByTestId('advance-week').click();
  await expect(page.getByTestId('calendar-day')).toHaveText('8', { timeout: 30_000 });
  await expect(page.getByTestId('header-forecast')).toHaveCount(0);
  expect(await figures(page)).toEqual(mineDay8);

  // and back: My company is still on its Day 8 (11 January); a day later the discount demand
  // arrives, and in the Decision Room its figures are labelled a forecast too
  await toArchive(page);
  await page.getByTestId('switch-mine').click();
  await toDesk(page);
  await expect(page.getByTestId('calendar-day')).toHaveText('11');
  await page.getByTestId('desk-bell').click();
  await expect(page.getByTestId('calendar-day')).toHaveText('12');
  await page.getByTestId('decision-folder').first().click();
  await page.getByTestId('dossier').getByRole('button', { name: 'Karar Odası' }).click();
  await expect(page.getByTestId('room-forecast')).toHaveText('Tahmin: rakamlar 4 Ocak 2027 anlık görüntüsünden ileriye hesaplandı.');
  await expect(page.getByTestId('header-forecast')).toBeVisible();

  // after a reload the same company and day come back
  await page.reload();
  await expect(page.getByTestId('calendar-day')).toHaveText('12');
  await expect(page.getByTestId('report-company')).toHaveText('NOVARA Sanayi');
});

test('a broken file: sheet, cell, column and problem in Turkish and English; Import stays disabled', async ({ page }, info) => {
  await clean(page);
  await toArchive(page);
  const broken = await brokenFile(await downloadTemplate(page, 'example', info.outputPath('ornek.xlsx')));
  await upload(page, broken);
  const report = page.getByTestId('inspection-report');
  await expect(report).toHaveAttribute('data-status', 'ready');
  await expect(page.getByTestId('count-errors')).toHaveText('2 hata');
  await expect(page.getByTestId('report-verdict')).toHaveText('Hatalar düzeltilmeden içe aktarılamaz.');
  await expect(page.getByTestId('import-button')).toBeDisabled();
  const fk = page.locator('[data-testid=issue][data-code="import.fk.missing"]');
  await expect(fk.getByTestId('issue-place')).toHaveText(/^OpenOrders![A-Z]+7 · Açık satış siparişleri$/);
  await expect(fk.getByTestId('issue-column')).toHaveText('Sütun: Müşteri kodu (customer_id)');
  await expect(fk.getByTestId('issue-message')).toHaveText('Bu kod Customers sayfasında yok.');
  await expect(fk).toContainText('Okunan değer: C-9999');
  const mail = page.locator('[data-testid=issue][data-code="import.privacy.email"]');
  await expect(mail.getByTestId('issue-place')).toHaveText(/^Customers![A-Z]+5 · Müşteriler$/);
  await expect(mail.getByTestId('issue-column')).toHaveText('Sütun: Müşteri adı (name)');
  await expect(mail.getByTestId('issue-message')).toContainText('E-posta adresine benziyor');
  await expect(mail).not.toContainText('satis@ornek.com.tr');

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByTestId('count-errors')).toHaveText('2 errors');
  await expect(fk.getByTestId('issue-place')).toHaveText(/^OpenOrders![A-Z]+7 · Open sales orders$/);
  await expect(fk.getByTestId('issue-column')).toHaveText('Column: Customer code (customer_id)');
  await expect(fk.getByTestId('issue-message')).toHaveText('This code does not exist in sheet Customers.');
  await expect(mail.getByTestId('issue-message')).toContainText('e-mail address');
  await expect(page.getByTestId('import-button')).toBeDisabled();

  // the report goes home as a file too
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('report-download-csv').click()]);
  expect(dl.suggestedFilename()).toBe('ceo-room-inspection-report.csv');
  const csv = readFileSync(await dl.path()).toString('utf8');
  expect(csv).toMatch(/Error,OpenOrders![A-Z]+7,import\.fk\.missing,This code does not exist in sheet Customers\.,C-9999/);
  await expect(page.getByTestId('switch-mine')).toBeDisabled();
});

test('files that are not workbooks get a plain message, and the room keeps working', async ({ page }) => {
  await clean(page);
  await toArchive(page);
  await upload(page, { name: 'notlar.txt', mimeType: 'text/plain', buffer: Buffer.from('customer_id;name\nC-1;Acme\n') });
  await expect(page.getByTestId('read-failure')).toHaveAttribute('data-failure', 'notXlsx');
  await expect(page.getByTestId('read-failure')).toContainText('notlar.txt okunamadı');
  await expect(page.getByTestId('read-failure')).toContainText('Excel (.xlsx) dosyası değil');
  await upload(page, { name: 'bozuk.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 9]) });
  await expect(page.getByTestId('read-failure')).toHaveAttribute('data-failure', 'corrupt');
  await expect(page.getByTestId('read-failure')).toContainText('bozuk');
  await upload(page, { name: 'bos.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.alloc(0) });
  await expect(page.getByTestId('read-failure')).toHaveAttribute('data-failure', 'empty');
  await toDesk(page);
  await page.getByTestId('desk-bell').click();
  await expect(page.getByTestId('calendar-day')).toHaveText('2');
});

test('remove my company data: confirmed, gone from the browser, the sample back on the desk', async ({ page }, info) => {
  await clean(page);
  await importExample(page, info.outputPath('novara.xlsx'));
  await page.getByTestId('remove-mine').click();
  await expect(page.getByTestId('confirm-remove')).toBeVisible();
  await page.getByTestId('confirm-remove').getByRole('button', { name: 'Vazgeç' }).click();
  await expect(page.getByTestId('switch-mine')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('remove-mine').click();
  await page.getByTestId('confirm-remove-yes').click();
  await expect(page.getByTestId('archive-note')).toContainText('silindi');
  await expect(page.getByTestId('switch-sample')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('switch-mine')).toBeDisabled();
  await expect(page.getByTestId('register-mine')).toHaveText('Şirketim: henüz dosya yok.');
  const stored = await page.evaluate(
    () =>
      new Promise<unknown[]>((resolve) => {
        const r = indexedDB.open('ceo-room', 1);
        r.onsuccess = () => {
          const tx = r.result.transaction('company', 'readonly');
          const all = tx.objectStore('company').getAllKeys();
          all.onsuccess = () => resolve(all.result as unknown[]);
        };
      }),
  );
  expect(stored).toEqual([]);
  expect(await page.evaluate(() => [localStorage.getItem('ceo-room.save.mine.v1'), localStorage.getItem('ceo-room.company')])).toEqual([null, null]);
  await page.reload();
  await toArchive(page);
  await expect(page.getByTestId('switch-mine')).toBeDisabled();
  await toDesk(page);
  await expect(page.getByTestId('header-day')).toHaveText('Gün 1 · Pazartesi');
});

test('a stored company that cannot start: the sample opens with a slip, and a reload does not fail again', async ({ page }, info) => {
  await clean(page);
  await importExample(page, info.outputPath('novara.xlsx'));
  // damage the stored company as an older version could have kept it: a card names a missing supplier
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open('ceo-room', 1);
        r.onsuccess = () => {
          const tx = r.result.transaction('company', 'readwrite');
          const store = tx.objectStore('company');
          const get = store.get('mine.data');
          get.onsuccess = () => {
            const data = get.result as { bundle: { eventCards: { effect: { kind: string; alternativeSupplierId?: string } }[] } };
            for (const c of data.bundle.eventCards) if (c.effect.kind === 'supplierPriceChange') c.effect.alternativeSupplierId = 'sup_gone';
            store.put(data, 'mine.data');
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  const slip = page.getByTestId('status-slip');
  await expect(slip).toContainText('Şirketiniz açılamadı');
  await expect(page.getByTestId('fatal-slip')).toHaveCount(0);
  await expect(page.getByTestId('header-day')).toHaveText('Gün 1 · Pazartesi');
  await expect(page.getByTestId('telegram')).toHaveCount(2); // the sample's Day 1
  await page.reload();
  await expect(page.getByTestId('header-day')).toHaveText('Gün 1 · Pazartesi');
  await expect(page.getByTestId('fatal-slip')).toHaveCount(0);
  await expect(page.getByTestId('status-slip')).toHaveCount(0);
  await toArchive(page);
  await expect(page.getByTestId('switch-sample')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('switch-mine')).toBeEnabled();
});

test('no network: template download, upload, validation, import and play only touch the site files', async ({ page }, info) => {
  const off: string[] = [];
  page.context().on('request', (r) => {
    const url = r.url();
    if (url.startsWith('blob:') || url.startsWith('data:')) return;
    if (new URL(url).origin !== ORIGIN || r.method() !== 'GET') off.push(`${r.method()} ${url}`);
  });
  await clean(page);
  await importExample(page, info.outputPath('novara.xlsx'));
  await downloadTemplate(page, 'empty', info.outputPath('empty.xlsx'));
  await upload(page, await brokenFile(info.outputPath('novara.xlsx')));
  await expect(page.getByTestId('count-errors')).toHaveText('2 hata');
  await page.getByTestId('report-download-xlsx').click();
  await page.getByTestId('drawer').first().click();
  await expect(page.getByTestId('drawer-row').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await toDesk(page);
  await page.getByTestId('play-pause').click();
  await expect(page.getByTestId('calendar-day')).not.toHaveText('4', { timeout: 10_000 });
  await page.getByTestId('play-pause').click();
  await page.reload();
  await expect(page.getByTestId('calendar-day')).toBeVisible();
  expect(off).toEqual([]);
});

/** Text below 12 px and controls below 44 px on screen, inside the scene (as in desk.spec.ts). */
const measure = (page: Page) =>
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
    const tiny = [...scene.querySelectorAll<HTMLElement>('button, label[for]')]
      .filter((b) => b.getClientRects().length > 0)
      .map((b) => ({ name: b.getAttribute('aria-label') ?? b.textContent, r: b.getBoundingClientRect() }))
      .filter(({ r }) => r.width < 44 || r.height < 44)
      .map(({ name, r }) => `${name}: ${Math.round(r.width)}×${Math.round(r.height)}`);
    return { scale, small, tiny };
  });

test('at the smallest scale (1280×700) the Archive Room stays legible: room, report, drawer, confirmation', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await clean(page);
  await toArchive(page);
  const empty = await measure(page);
  expect(empty.scale).toBeCloseTo(0.78, 2);
  expect(empty.small).toEqual([]);
  expect(empty.tiny).toEqual([]);

  await upload(page, await brokenFile(await downloadTemplate(page, 'example', info.outputPath('ornek.xlsx'))));
  await expect(page.getByTestId('count-errors')).toHaveText('2 hata');
  const withReport = await measure(page);
  expect(withReport.small).toEqual([]);
  expect(withReport.tiny).toEqual([]);

  await page.getByTestId('drawer').filter({ hasText: 'Satış siparişleri' }).click();
  await expect(page.getByTestId('drawer-row').first()).toBeVisible();
  const drawer = await measure(page);
  expect(drawer.small).toEqual([]);
  expect(drawer.tiny).toEqual([]);
  await page.keyboard.press('Escape');

  await upload(page, info.outputPath('ornek.xlsx'));
  await page.getByTestId('import-button').click();
  await expect(page.getByTestId('remove-mine')).toBeVisible();
  await page.getByTestId('remove-mine').click();
  const confirm = await measure(page);
  expect(confirm.small).toEqual([]);
  expect(confirm.tiny).toEqual([]);
  await page.getByTestId('confirm-remove-yes').click();
});

test.describe('at 1440×900 the Archive Room fits without page scroll', () => {
  for (const locale of ['tr', 'en'] as const) {
    test(`${locale}: every part inside the window, only the drawer table scrolls`, async ({ page }, info) => {
      await clean(page);
      if (locale === 'en') await page.getByRole('button', { name: 'English' }).click();
      await importExample(page, info.outputPath('novara.xlsx'));
      await upload(page, await brokenFile(info.outputPath('novara.xlsx')));
      await expect(page.getByTestId('count-errors')).toContainText('2');
      const vp = page.viewportSize()!;
      const page_ = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth }));
      expect(page_.sh).toBeLessThanOrEqual(vp.height);
      expect(page_.sw).toBeLessThanOrEqual(vp.width);
      const scene = (await page.getByTestId('scene').boundingBox())!;
      for (const id of ['filing-cabinet', 'company-switch', 'blotter', 'template-forms', 'register', 'inspection-report', 'privacy-notice']) {
        const box = (await page.getByTestId(id).boundingBox())!;
        expect(box.x, id).toBeGreaterThanOrEqual(scene.x);
        expect(box.y, id).toBeGreaterThanOrEqual(scene.y);
        expect(box.x + box.width, id).toBeLessThanOrEqual(scene.x + scene.width + 1);
        expect(box.y + box.height, id).toBeLessThanOrEqual(scene.y + scene.height + 1);
        // nothing inside is cut off: no part of the room scrolls but the report's list
        const m = await page.getByTestId(id).evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
        expect(m.sh, `${id} overflows`).toBeLessThanOrEqual(m.ch + 1);
      }
      await expect(page.getByTestId('credit')).toBeInViewport();
      await page.getByTestId('remove-mine').click();
      await page.getByTestId('confirm-remove-yes').click();
    });
  }
});

test('keyboard: the Archive Room tab, the file button and a drawer are reachable; Escape returns focus', async ({ page }) => {
  await clean(page);
  await page.getByTestId('tab-archive').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('archive-room')).toBeVisible();
  await expect(page.getByTestId('tab-archive')).toBeFocused();
  await expect(page.getByTestId('tab-archive')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('room-name')).toHaveText('Arşiv Odası');
  const drawer = page.getByTestId('drawer').first();
  await drawer.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('drawer-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('drawer-sheet')).toHaveCount(0);
  await expect(drawer).toBeFocused();
  // the file input itself takes focus (it opens the browser's file chooser)
  await page.getByTestId('file-input').focus();
  await expect(page.getByTestId('file-input')).toBeFocused();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Space');
  expect((await chooser).isMultiple()).toBe(false);
  await page.getByTestId('tab-desk').click();
  await expect(page.getByTestId('calendar-day')).toBeVisible();
  await expect(page.getByTestId('credit')).toBeVisible();
});
