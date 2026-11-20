/** The xlsx adapter: Workbook → .xlsx bytes → Workbook is lossless (blank tails aside). */
import { describe, expect, it } from 'vitest';
import { exportTemplate, validateWorkbook } from '@ceo-room/import';
import { loadSeed } from '@ceo-room/seed-data';
import { MAX_FILE_BYTES, XlsxReadError, trimWorkbook, workbookToXlsx, xlsxToWorkbook } from './xlsx';

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
});
