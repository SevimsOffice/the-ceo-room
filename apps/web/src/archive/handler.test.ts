/**
 * The archive worker's handler: template downloads, inspection of uploads (good, broken, not xlsx),
 * building My company (NOVARA's own data keeps its storyline; another company gets the generic
 * profile), the report file and the drawers' tables.
 */
import { describe, expect, it } from 'vitest';
import { createEngine, selectMorningReport } from '@ceo-room/engine';
import { type Cell, type Workbook, cellRef, exportTemplate } from '@ceo-room/import';
import { loadSeed } from '@ceo-room/seed-data';
import { realCompany } from '../../../../packages/import/test/fixtures';
import { RNG_SEED, WORKSPACE_ID } from '../worker/handler';
import { trimWorkbook, workbookToXlsx, xlsxToWorkbook } from '../xlsx/xlsx';
import { browseBook, createArchiveHandler, toCsv } from './handler';
import type { ArchiveRequest, ArchiveResponse } from './protocol';

const seed = loadSeed();

function harness() {
  const out: ArchiveResponse[] = [];
  const h = createArchiveHandler({ seed, post: (m) => out.push(structuredClone(m)) });
  const ask = async (req: ArchiveRequest): Promise<ArchiveResponse> => {
    await h.handle(req);
    const r = out.find((m) => m.requestId === req.requestId);
    if (!r) throw new Error('no answer');
    return r;
  };
  return { ask };
}

const bytesOf = async (b: Blob): Promise<ArrayBuffer> => b.arrayBuffer();
const xlsx = async (wb: Workbook): Promise<ArrayBuffer> => bytesOf(await workbookToXlsx(wb));

function setCell(wb: Workbook, sheet: string, row: number, key: string, value: Cell): void {
  const col = wb[sheet]![0]!.indexOf(key);
  wb[sheet]![row - 1]![col] = value;
}

describe('archive handler', () => {
  it('writes both templates as xlsx: the NOVARA example and the empty one', async () => {
    const { ask } = harness();
    const ex = await ask({ type: 'template', requestId: 1, lang: 'tr', example: true });
    const empty = await ask({ type: 'template', requestId: 2, lang: 'en', example: false });
    if (ex.type !== 'file' || empty.type !== 'file') throw new Error('no file');
    const a = await xlsxToWorkbook(await bytesOf(ex.file));
    expect(trimWorkbook(a)).toEqual(trimWorkbook(exportTemplate(seed, { lang: 'tr', example: true })));
    const b = await xlsxToWorkbook(await bytesOf(empty.file));
    expect(b.README![0]!.slice(0, 2)).toEqual(['ceo_room_template_version', 1]);
    expect(b.Customers!.length).toBe(3);
    expect(b.Customers![1]![0]).toMatch(/Customer code/);
  });

  it('inspects the downloaded example: zero errors, rows per sheet', async () => {
    const { ask } = harness();
    const r = await ask({ type: 'inspect', requestId: 1, bytes: await xlsx(exportTemplate(seed, { lang: 'en', example: true })) });
    if (r.type !== 'inspected' || !r.ok) throw new Error('not inspected');
    expect(r.report.summary.errors).toBe(0);
    expect(r.report.summary.rows.Customers).toBe(8);
    expect(r.report.snapshotDate).toBe('2027-01-04');
  });

  it('reports a broken file with sheet, row, column and code (foreign key and privacy)', async () => {
    const { ask } = harness();
    const wb = exportTemplate(seed, { lang: 'tr', example: true });
    setCell(wb, 'OpenOrders', 7, 'customer_id', 'C-9999');
    setCell(wb, 'Customers', 5, 'name', 'satis@ornek.com.tr');
    const r = await ask({ type: 'inspect', requestId: 1, bytes: await xlsx(wb) });
    if (r.type !== 'inspected' || !r.ok) throw new Error('not inspected');
    const fk = r.report.issues.find((i) => i.code === 'import.fk.missing')!;
    expect(fk).toMatchObject({ severity: 'error', sheet: 'OpenOrders', row: 7, column: 'customer_id', value: 'C-9999' });
    expect(cellRef(fk)).toMatch(/^OpenOrders![A-Z]+7$/);
    const mail = r.report.issues.find((i) => i.code === 'import.privacy.email')!;
    expect(mail).toMatchObject({ severity: 'error', sheet: 'Customers', row: 5, column: 'name' });
    expect(mail.value).toBeUndefined();
    const built = await ask({ type: 'build', requestId: 2, workbook: r.workbook });
    expect(built).toMatchObject({ type: 'built', ok: false });
  });

  it('answers files that are not xlsx with a reason, never an exception', async () => {
    const { ask } = harness();
    const text = new TextEncoder().encode('customer_id;name\nC-1;Acme\n');
    expect(await ask({ type: 'inspect', requestId: 1, bytes: text.buffer })).toMatchObject({ ok: false, failure: 'notXlsx' });
    const zipish = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
    expect(await ask({ type: 'inspect', requestId: 2, bytes: zipish.buffer })).toMatchObject({ ok: false, failure: 'corrupt' });
  });

  it("builds My company from NOVARA's own file with its storyline: Day 1 equals the sample's", async () => {
    const { ask } = harness();
    const r = await ask({ type: 'build', requestId: 1, workbook: exportTemplate(seed, { lang: 'tr', example: true }) });
    if (r.type !== 'built' || !r.ok) throw new Error('not built');
    expect(r.profile).toBe('sample');
    expect(r.companyName).toBe('NOVARA Sanayi');
    expect(r.bundle.company.company).toMatchObject({ source: 'import', snapshotDate: '2027-01-04', name: 'NOVARA Sanayi' });
    const mine = createEngine(r.bundle, { rngSeed: RNG_SEED, workspaceId: WORKSPACE_ID });
    const sample = createEngine(seed, { rngSeed: RNG_SEED, workspaceId: WORKSPACE_ID });
    const figures = (e: typeof mine) => {
      const { company: _c, date: _d, forecast: _f, ...rest } = selectMorningReport(e.state(), { includeRunway: false });
      return rest;
    };
    expect(figures(mine)).toEqual(figures(sample));
    mine.advance(7);
    sample.advance(7);
    expect(figures(mine)).toEqual(figures(sample));
    expect(selectMorningReport(mine.state(), { includeRunway: false })).toMatchObject({ date: '2027-01-11', forecast: true });
  });

  it('the sample with a supplier deleted gets the generic profile and the engine starts (no storyline on missing records)', async () => {
    const { ask } = harness();
    const wb = exportTemplate(seed, { lang: 'tr', example: true });
    const drop = (sheet: string, key: string, value: string) => {
      const col = wb[sheet]![0]!.indexOf(key);
      wb[sheet] = wb[sheet]!.filter((r, i) => i < 3 || r[col] !== value);
    };
    for (const [sheet, key] of [['Suppliers', 'supplier_id'], ['SupplierPrices', 'supplier_id'], ['OpenPurchaseOrders', 'supplier_id'], ['Payables', 'supplier_id']] as const) drop(sheet, key, 'sup_dogumetal');
    const r = await ask({ type: 'build', requestId: 1, workbook: wb });
    if (r.type !== 'built' || !r.ok) throw new Error(JSON.stringify(r));
    expect(r.profile).toBe('generic');
    expect(r.bundle.company.company.simulated).toBe(false);
    expect(r.bundle.departments.every((d) => d.headName === '')).toBe(true);
    expect(r.bundle.eventCards.some((c) => c.effect.kind === 'supplierPriceChange')).toBe(false);
    const e = createEngine(r.bundle, { rngSeed: RNG_SEED, workspaceId: WORKSPACE_ID });
    e.advance(30);
    expect(e.state().day).toBe(31);
  });

  it("the sample's ids with other figures get the generic profile; the unchanged sample keeps its storyline", async () => {
    const { ask } = harness();
    const wb = exportTemplate(seed, { lang: 'en', example: true });
    const cash = wb.Cash![3]![wb.Cash![0]!.indexOf('balance')] as number;
    setCell(wb, 'Cash', 4, 'balance', cash + 1);
    const changed = await ask({ type: 'build', requestId: 1, workbook: wb });
    if (changed.type !== 'built' || !changed.ok) throw new Error('not built');
    expect(changed.profile).toBe('generic');
    expect(changed.bundle.company.company.simulated).toBe(false);
    // renaming the company or a customer (labels) is still the sample
    const renamed = exportTemplate(seed, { lang: 'en', example: true });
    setCell(renamed, 'Settings', 4, 'company_name', 'Acme Test');
    setCell(renamed, 'Customers', 4, 'name', 'Renamed Customer Ltd');
    const same = await ask({ type: 'build', requestId: 2, workbook: renamed });
    if (same.type !== 'built' || !same.ok) throw new Error('not built');
    expect(same.profile).toBe('sample');
  });

  it('builds another company with the generic profile (data-driven cards, its plain name)', async () => {
    const { ask } = harness();
    const r = await ask({ type: 'build', requestId: 1, workbook: realCompany() });
    if (r.type !== 'built' || !r.ok) throw new Error(JSON.stringify(r));
    expect(r.profile).toBe('generic');
    expect(r.companyName).toBe('Örnek Makina A.Ş.');
    expect(r.bundle.eventCards.map((c) => c.kindKey).sort()).toEqual(['cashSqueeze', 'turnoverRising']);
  });

  it('writes the inspection report as xlsx and as csv (translated)', async () => {
    const { ask } = harness();
    const wb = exportTemplate(seed, { lang: 'en', example: true });
    setCell(wb, 'OpenOrders', 7, 'customer_id', 'C-9999');
    const ins = await ask({ type: 'inspect', requestId: 1, bytes: await xlsx(wb) });
    if (ins.type !== 'inspected' || !ins.ok) throw new Error('not inspected');
    const csv = await ask({ type: 'reportFile', requestId: 2, report: ins.report, lang: 'en', format: 'csv' });
    if (csv.type !== 'file') throw new Error('no csv');
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await csv.file.arrayBuffer());
    expect(text.startsWith('﻿Severity,Cell,code,Message,Value')).toBe(true);
    expect(text).toMatch(/Error,OpenOrders![A-Z]+7,import\.fk\.missing,This code does not exist in sheet Customers\.,C-9999/);
    const book = await ask({ type: 'reportFile', requestId: 3, report: ins.report, lang: 'tr', format: 'xlsx' });
    if (book.type !== 'file') throw new Error('no xlsx');
    const read = await xlsxToWorkbook(await bytesOf(book.file));
    expect(read.Rapor![0]).toEqual(['Önem', 'Hücre', 'code', 'Mesaj', 'Değer']);
    expect(read.Rapor!.length).toBe(ins.report.issues.length + 1);
  });

  it("browses the sample from its own template and My company from its workbook", async () => {
    const { ask } = harness();
    const r = await ask({ type: 'browse', requestId: 1, company: 'sample', workbook: null, lang: 'en' });
    if (r.type !== 'browsed') throw new Error('no book');
    const customers = r.book.sheets.find((s) => s.name === 'Customers')!;
    expect(customers.rows.length).toBe(8);
    const money = customers.columns.findIndex((c) => c.key === 'annual_revenue');
    expect(typeof customers.rows[0]![money]).toBe('number');
    const mine = browseBook('mine', realCompany());
    expect(mine.snapshotDate).toBe('2027-01-31');
    expect(mine.sheets.find((s) => s.name === 'Settings')!.rows[0]![0]).toBe('Örnek Makina A.Ş.');
  });

  it('quotes CSV cells that need it', () => {
    expect(toCsv([['a', 'b,c', 'say "hi"', null, true]])).toBe('﻿a,"b,c","say ""hi""",,TRUE\r\n');
  });

  it('never writes a cell a spreadsheet would run as a formula (CSV and xlsx report)', async () => {
    expect(toCsv([['=HYPERLINK("http://x","y")', '+1', '-1+1', '@SUM(A1)', '\tx', '\rx', 'ok', -5]])).toBe(
      `﻿"'=HYPERLINK(""http://x"",""y"")",'+1,'-1+1,'@SUM(A1),'\tx,"'\rx",ok,-5\r\n`,
    );
    const { ask } = harness();
    const wb = exportTemplate(seed, { lang: 'en', example: true });
    setCell(wb, 'OpenOrders', 7, 'customer_id', '=cmd|calc');
    const ins = await ask({ type: 'inspect', requestId: 1, bytes: await xlsx(wb) });
    if (ins.type !== 'inspected' || !ins.ok) throw new Error('not inspected');
    const csv = await ask({ type: 'reportFile', requestId: 2, report: ins.report, lang: 'en', format: 'csv' });
    if (csv.type !== 'file') throw new Error('no csv');
    const text = new TextDecoder().decode(await csv.file.arrayBuffer());
    expect(text).toContain(",'=cmd|calc");
    expect(text).not.toMatch(/(^|,)=cmd/m);
    const book = await ask({ type: 'reportFile', requestId: 3, report: ins.report, lang: 'en', format: 'xlsx' });
    if (book.type !== 'file') throw new Error('no xlsx');
    const rows = (await xlsxToWorkbook(await bytesOf(book.file))).Report!;
    expect(rows.some((r) => r[4] === "'=cmd|calc")).toBe(true);
    // every report cell is text
    expect(rows.flat().every((c) => c === null || typeof c === 'string')).toBe(true);
  });

  it('inspection returns only the sanitised workbook: no sheet or column outside the template', async () => {
    const { ask } = harness();
    const wb = exportTemplate(seed, { lang: 'en', example: true });
    wb.Notes = [['topic'], ['call the bank on Monday']];
    wb.Customers![0]!.push('remarks');
    wb.Customers![3]!.push('prefers mornings');
    const r = await ask({ type: 'inspect', requestId: 1, bytes: await xlsx(wb) });
    if (r.type !== 'inspected' || !r.ok) throw new Error('not inspected');
    expect(r.report.issues.filter((i) => i.severity === 'warning').map((i) => i.code)).toEqual(expect.arrayContaining(['import.structure.unknownSheet', 'import.structure.unknownColumn']));
    expect(Object.keys(r.workbook)).not.toContain('Notes');
    expect(JSON.stringify(r.workbook)).not.toMatch(/remarks|prefers mornings|call the bank/);
    const built = await ask({ type: 'build', requestId: 2, workbook: r.workbook });
    if (built.type !== 'built' || !built.ok) throw new Error('not built');
    expect(built.profile).toBe('sample');
    expect(built.workbook).toEqual(r.workbook);
  });

  it('a personal-data sheet next to the template blocks the import', async () => {
    const { ask } = harness();
    const wb = exportTemplate(seed, { lang: 'tr', example: true });
    wb.Personel = [['Ad Soyad', 'Maaş'], ['Ayşe Kaya', 85000]];
    const r = await ask({ type: 'inspect', requestId: 1, bytes: await xlsx(wb) });
    if (r.type !== 'inspected' || !r.ok) throw new Error('not inspected');
    expect(r.report.issues.find((i) => i.code === 'import.privacy.personSheet')).toMatchObject({ severity: 'error', sheet: 'Personel' });
    expect(JSON.stringify(r)).not.toContain('Ayşe');
  });
});
