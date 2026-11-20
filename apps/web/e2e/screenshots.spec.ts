import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { workbookToXlsx, xlsxToWorkbook } from '../src/xlsx/xlsx';

/**
 * Review screenshots of the Archive Room and of My company on the Desk (1440×900, tr and en).
 * Runs only when SCREENSHOT_DIR is set: `SCREENSHOT_DIR=/tmp/shots pnpm exec playwright test screenshots`.
 */
const dir = process.env.SCREENSHOT_DIR;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

for (const locale of ['tr', 'en'] as const) {
  test(`screenshots (${locale})`, async ({ page }, info) => {
    test.skip(!dir, 'SCREENSHOT_DIR not set');
    const shot = (name: string) => page.screenshot({ path: join(dir!, `${locale}-${name}.png`) });
    await page.goto('./');
    await page.evaluate(async (l) => {
      localStorage.clear();
      localStorage.setItem('ceo-room.locale', l);
      await new Promise<void>((resolve) => {
        const r = indexedDB.deleteDatabase('ceo-room');
        r.onsuccess = r.onerror = r.onblocked = () => resolve();
      });
    }, locale);
    await page.reload();
    await expect(page.getByTestId('calendar-day')).toHaveText('1');
    await page.getByTestId('tab-archive').click();
    await page.waitForTimeout(900);
    await shot('archive-empty');

    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-example').click()]);
    const path = info.outputPath('example.xlsx');
    await dl.saveAs(path);
    const good = readFileSync(path);
    const wb = await xlsxToWorkbook(good);
    const set = (sheet: string, row: number, key: string, v: string) => {
      wb[sheet]![row - 1]![wb[sheet]![0]!.indexOf(key)] = v;
    };
    set('OpenOrders', 7, 'customer_id', 'C-9999');
    set('Customers', 5, 'name', 'satis@ornek.com.tr');
    const broken = Buffer.from(await (await workbookToXlsx(wb)).arrayBuffer());
    await page.getByTestId('file-input').setInputFiles({ name: 'firma.xlsx', mimeType: XLSX, buffer: broken });
    await expect(page.getByTestId('inspection-report')).toHaveAttribute('data-status', 'ready');
    await shot('report-errors');

    await page.getByTestId('drawer').nth(10).click();
    await expect(page.getByTestId('drawer-row').first()).toBeVisible();
    await page.waitForTimeout(700);
    await shot('drawer');
    await page.keyboard.press('Escape');

    await page.getByTestId('file-input').setInputFiles({ name: 'novara.xlsx', mimeType: XLSX, buffer: good });
    await expect(page.getByTestId('import-button')).toBeEnabled();
    await page.getByTestId('import-button').click();
    await expect(page.getByTestId('archive-note')).toBeVisible();
    await page.waitForTimeout(600);
    await shot('archive-imported');
    await page.getByTestId('tab-desk').click();
    await page.getByTestId('advance-week').click();
    await expect(page.getByTestId('header-forecast')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('gauge-runway-value')).toHaveText(/\d/);
    await page.waitForTimeout(1200);
    await shot('desk-mine-forecast');
  });
}
