/** The xlsx adapter: Workbook → .xlsx bytes → Workbook is lossless (blank tails aside). */
import { describe, expect, it } from 'vitest';
import writeXlsxFile from 'write-excel-file/universal';
import { exportTemplate, validateWorkbook } from '@ceo-room/import';
import { loadSeed } from '@ceo-room/seed-data';
import { MAX_FILE_BYTES, MAX_UNZIPPED_BYTES, XlsxReadError, trimWorkbook, workbookToXlsx, xlsxToWorkbook } from './xlsx';
import { fractionToPercent, isPercentFormatCode } from './formats';
import { readZipDirectory, unzippedSize } from './zip';

const seed = loadSeed();
const bytes = async (b: Blob): Promise<Uint8Array> => new Uint8Array(await b.arrayBuffer());

describe('xlsx adapter', () => {
  it.each(['tr', 'en'] as const)('round-trips the filled NOVARA template (%s)', async (lang) => {
    const wb = exportTemplate(seed, { lang, example: true });
    const back = await xlsxToWorkbook(await bytes(await workbookToXlsx(wb)));
    expect(Object.keys(back)).toEqual(Object.keys(wb));
    expect(trimWorkbook(back)).toEqual(trimWorkbook(wb));
    expect(validateWorkbook(back)).toEqual(validateWorkbook(wb));
  });

  it('round-trips the empty template and odd cells (blank rows, booleans, negatives, decimals, unicode)', async () => {
    const wb = exportTemplate(seed, { lang: 'tr', example: false });
    wb.Extra = [['a', null, 'ş', true], [], [null, -12.5, 0.1, false], ['2027-01-31']];
    const back = trimWorkbook(await xlsxToWorkbook(await bytes(await workbookToXlsx(wb))));
    expect(back).toEqual(trimWorkbook(wb));
  });

  it('writes the template date columns as real Excel dates and reads them back as ISO text', async () => {
    const wb = exportTemplate(seed, { lang: 'en', example: true });
    const blob = await workbookToXlsx(wb);
    const back = await xlsxToWorkbook(await bytes(blob));
    expect(back.Settings![3]![1]).toBe('2027-01-04');
  });

  it('refuses what is not an xlsx file', async () => {
    const fail = async (b: Uint8Array) => {
      try {
        await xlsxToWorkbook(b);
      } catch (e) {
        return e instanceof XlsxReadError ? e.code : 'other';
      }
      return 'read';
    };
    expect(await fail(new Uint8Array())).toBe('empty');
    expect(await fail(new TextEncoder().encode('customer_id,name\nC-1,Acme\n'))).toBe('notXlsx');
    expect(await fail(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8]))).toBe('corrupt');
    expect(await fail(new Uint8Array(MAX_FILE_BYTES + 1))).toBe('tooLarge');
  });

  const failure = async (b: Uint8Array, limits?: { cells: number; columns: number }) => {
    try {
      await xlsxToWorkbook(b, limits);
    } catch (e) {
      return e instanceof XlsxReadError ? e.code : 'other';
    }
    return 'read';
  };

  it('refuses a zip bomb from its central directory, before inflating anything', async () => {
    const good = await bytes(await workbookToXlsx(exportTemplate(seed, { lang: 'en', example: true })));
    const entries = readZipDirectory(good)!;
    expect(entries.length).toBeGreaterThan(3);
    expect(unzippedSize(entries)).toBeLessThan(MAX_UNZIPPED_BYTES);
    // declare one part as 80 MB (a bomb's directory says what it unpacks to)
    const bomb = good.slice();
    const view = new DataView(bomb.buffer);
    let at = -1;
    for (let i = 0; i < bomb.length - 4; i++) if (view.getUint32(i, true) === 0x02014b50) { at = i; break; }
    view.setUint32(at + 24, 80 * 1024 * 1024, true);
    expect(await failure(bomb)).toBe('unzippedTooLarge');
    // ZIP64 size markers count as too large too
    view.setUint32(at + 24, 0xffffffff, true);
    expect(await failure(bomb)).toBe('unzippedTooLarge');
    // a "PK" file without a directory is damaged
    expect(await failure(good.slice(0, 200))).toBe('corrupt');
  });

  it('caps the columns of a sheet and the cells of the workbook', async () => {
    const wide = await bytes(await workbookToXlsx({ Wide: [Array.from({ length: 201 }, (_, i) => i)] }));
    expect(await failure(wide)).toBe('tooManyCells');
    const many = await bytes(await workbookToXlsx({ A: [[1, 2, 3], [4, 5, 6]], B: [[7, 8, 9]] }));
    expect(await failure(many, { cells: 8, columns: 10 })).toBe('tooManyCells');
    expect(await failure(many, { cells: 9, columns: 10 })).toBe('read');
  });

  it('reads cells formatted as percentages as shown (95 %, not 0.95) in the template percent columns only', async () => {
    const wb = exportTemplate(seed, { lang: 'en', example: false });
    const header = wb.Suppliers![0]!;
    const row = header.map((): { value: number | string; type: typeof Number | typeof String; format?: string } | null => null);
    const put = (key: string, value: number, format?: string) => (row[header.indexOf(key)] = { value, type: Number, ...(format ? { format } : {}) });
    row[header.indexOf('supplier_id')] = { value: 'S1', type: String };
    put('on_time_delivery_pct', 0.95, '0%');
    put('deposit_pct', 0.125, '0.0%');
    put('payment_terms_days', 0.3, '0%'); // not a percent column: left as it is
    const text = (r: (string | number | boolean | null)[]) => r.map((c) => (c === null ? null : { value: String(c), type: String }));
    const file = await writeXlsxFile(
      [
        { sheet: 'Suppliers', data: [text(header), text(wb.Suppliers![1]!), text(wb.Suppliers![2]!), row] },
        { sheet: 'Notes', data: [[{ value: 0.5, type: Number, format: '0%' }]] },
      ] as never,
    ).toBlob();
    const back = await xlsxToWorkbook(await bytes(file));
    const r4 = back.Suppliers![3]!;
    expect(r4[header.indexOf('on_time_delivery_pct')]).toBe(95);
    expect(r4[header.indexOf('deposit_pct')]).toBe(12.5);
    expect(r4[header.indexOf('payment_terms_days')]).toBe(0.3);
    expect(back.Notes![0]![0]).toBe(0.5);
  });

  it('percent formats: codes with % outside quotes, exact decimal shift', () => {
    expect(isPercentFormatCode('0.00%')).toBe(true);
    expect(isPercentFormatCode('#,##0.0" %"')).toBe(false);
    expect(isPercentFormatCode('0\\%')).toBe(false);
    expect(fractionToPercent(0.95)).toBe(95);
    expect(fractionToPercent(0.07)).toBe(7);
    expect(fractionToPercent(0.123)).toBe(12.3);
    expect(fractionToPercent(1e-7)).toBe(0.00001);
    expect(fractionToPercent(-0.5)).toBe(-50);
  });
});
