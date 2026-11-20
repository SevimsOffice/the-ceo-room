// @vitest-environment jsdom
/**
 * The Archive Room on paper: the inspection report types every finding with its sheet, Excel cell,
 * column and problem in the chosen language; Import stays disabled while there are errors; the
 * switch, the register and the privacy notice; a drawer prints the records with i18n formats.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createTranslator } from '@ceo-room/i18n';
import { exportTemplate, validateWorkbook } from '@ceo-room/import';
import { loadSeed } from '@ceo-room/seed-data';
import { useArchive } from '../store/archive';
import { useGame } from '../store/game';
import { ArchiveRoom } from './ArchiveRoom';
import { browseBook } from './handler';
import { cellText } from './cells';
import { InspectionReport, sortedIssues } from './InspectionReport';

const seed = loadSeed();
const initialGame = useGame.getState();
const initialArchive = useArchive.getState();

function brokenReport() {
  const wb = exportTemplate(seed, { lang: 'tr', example: true });
  const set = (sheet: string, row: number, key: string, v: string) => {
    wb[sheet]![row - 1]![wb[sheet]![0]!.indexOf(key)] = v;
  };
  set('OpenOrders', 7, 'customer_id', 'C-9999');
  set('Customers', 5, 'name', 'satis@ornek.com.tr');
  return { wb, report: validateWorkbook(wb) };
}

beforeEach(() => {
  useGame.setState({ ...initialGame, phase: 'ready' }, true);
  useArchive.setState(initialArchive, true);
});
afterEach(() => cleanup());

describe('inspection report', () => {
  it.each([
    ['tr', 'HATA', 'Bu kod Customers sayfasında yok.', 'Sütun: Müşteri kodu (customer_id)', 'Açık satış siparişleri'],
    ['en', 'ERROR', 'This code does not exist in sheet Customers.', 'Column: Customer code (customer_id)', 'Open sales orders'],
  ] as const)('%s: sheet, cell, column and problem of each error; Import disabled', (locale, _stamp, fk, column, sheetLabel) => {
    const { wb, report } = brokenReport();
    useGame.setState({ locale });
    useArchive.setState({ inspection: { status: 'ready', fileName: 'firma.xlsx', fileSize: 1, report, workbook: wb, imported: false } });
    render(<InspectionReport />);
    const lines = screen.getAllByTestId('issue');
    // errors first
    expect(lines[0]!.dataset.severity).toBe('error');
    const fkLine = lines.find((l) => l.dataset.code === 'import.fk.missing')!;
    expect(within(fkLine).getByTestId('issue-place').textContent).toMatch(new RegExp(`^OpenOrders![A-Z]+7 · ${sheetLabel}$`));
    expect(within(fkLine).getByTestId('issue-column').textContent).toBe(column);
    expect(within(fkLine).getByTestId('issue-message').textContent).toBe(fk);
    expect(fkLine.textContent).toContain('C-9999');
    const mail = lines.find((l) => l.dataset.code === 'import.privacy.email')!;
    expect(within(mail).getByTestId('issue-place').textContent).toMatch(/^Customers![A-Z]+5 /);
    // the personal datum itself is never typed back
    expect(mail.textContent).not.toContain('satis@ornek.com.tr');
    const t = createTranslator(locale);
    expect(screen.getByTestId('count-errors').textContent).toBe(t.plural('ui.archive.report.errors', 2));
    expect(screen.getByTestId('report-verdict').textContent).toBe(t.t('ui.archive.report.blocked'));
    expect((screen.getByTestId('import-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a clean file can be imported; findings sort errors, warnings, notes', () => {
    const wb = exportTemplate(seed, { lang: 'en', example: true });
    const report = validateWorkbook(wb);
    useArchive.setState({ inspection: { status: 'ready', fileName: 'novara.xlsx', fileSize: 1, report, workbook: wb, imported: false } });
    render(<InspectionReport />);
    expect((screen.getByTestId('import-button') as HTMLButtonElement).disabled).toBe(false);
    const sev = sortedIssues(brokenReport().report).map((i) => i.severity);
    expect(sev).toEqual([...sev].sort((a, b) => ['error', 'warning', 'info'].indexOf(a) - ['error', 'warning', 'info'].indexOf(b)));
  });

  it('says why a file could not be read', () => {
    useGame.setState({ locale: 'en' });
    useArchive.setState({ inspection: { status: 'failed', fileName: 'photo.png', failure: 'notXlsx' } });
    render(<InspectionReport />);
    expect(screen.getByTestId('read-failure').textContent).toContain('photo.png could not be read');
    expect(screen.getByTestId('read-failure').textContent).toContain('not an Excel (.xlsx) file');
  });
});

describe('the room', () => {
  it('My company is off until something is imported; the privacy notice and the upload line are on the page', () => {
    useGame.setState({ locale: 'en' });
    render(<ArchiveRoom />);
    expect((screen.getByTestId('switch-mine') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('switch-sample').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('privacy-notice').textContent).toContain('never sent anywhere');
    expect(screen.getByTestId('upload-privacy').textContent).toContain('never sent anywhere');
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.tabIndex).not.toBe(-1);
    expect(screen.getAllByTestId('drawer')).toHaveLength(18);
    expect(screen.queryByTestId('remove-mine')).toBeNull();
  });

  it('with My company stored: the switch, the register entry and the remove control', () => {
    useGame.setState({
      locale: 'tr',
      company: 'mine',
      myCompany: {
        format: 1,
        fileName: 'firma.xlsx',
        fileSize: 1000,
        importedAt: '2027-02-01T09:30:00.000Z',
        snapshotDate: '2027-01-31',
        companyName: 'Örnek Makina A.Ş.',
        summary: { errors: 0, warnings: 2, info: 5, rows: { Customers: 3, OpenOrders: 4 } },
        profile: 'generic',
      },
    });
    render(<ArchiveRoom />);
    expect((screen.getByTestId('switch-mine') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('switch-mine').getAttribute('aria-pressed')).toBe('true');
    const mine = screen.getByTestId('register-mine');
    expect(mine.textContent).toContain('Örnek Makina A.Ş.');
    expect(mine.textContent).toContain('Excel yüklemesi · firma.xlsx');
    expect(mine.textContent).toContain('1. gün 31.01.2027 · 7 satır');
    expect(screen.getByTestId('register-status').textContent).toBe('Denetim: 0 hata · 2 uyarı · 5 not');
    expect(screen.getByTestId('cabinet-company').textContent).toBe('Örnek Makina A.Ş. · 31.01.2027');
    act(() => fireEvent.click(screen.getByTestId('remove-mine')));
    expect(useArchive.getState().confirm).toBe('remove');
    expect(screen.getByTestId('confirm-remove')).toBeTruthy();
  });
});

describe('drawer cells', () => {
  it('prints money, percentages, booleans and dates with the i18n formats', () => {
    const book = browseBook('sample', exportTemplate(seed, { lang: 'tr', example: true }));
    const customers = book.sheets.find((s) => s.name === 'Customers')!;
    const tr = createTranslator('tr');
    const at = (key: string) => customers.columns.findIndex((c) => c.key === key);
    const row = customers.rows[0]!;
    expect(cellText(tr, customers.columns[at('annual_revenue')]!, row[at('annual_revenue')]!, book)).toMatch(/^[\d.]+,\d\d TL$/);
    expect(cellText(tr, customers.columns[at('key_account')]!, row[at('key_account')]!, book)).toMatch(/^(Evet|Hayır)$/);
    const orders = book.sheets.find((s) => s.name === 'OpenOrders')!;
    const date = orders.columns.findIndex((c) => c.key === 'order_date');
    // the sample has no calendar: its dates are day numbers
    expect(cellText(tr, orders.columns[date]!, orders.rows[0]![date]!, book)).toMatch(/^Gün −?\d+$/);
    const mine = { ...book, company: 'mine' as const };
    expect(cellText(tr, orders.columns[date]!, '2027-01-31', mine)).toBe('31.01.2027');
  });
});
