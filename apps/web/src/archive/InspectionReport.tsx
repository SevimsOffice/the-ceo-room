import { type ImportIssue, type ImportReport, TEMPLATE, cellRef } from '@ceo-room/import';
import type { Translator } from '@ceo-room/i18n';
import { useT } from '../i18n';
import { importReady, useArchive } from '../store/archive';
import { canSwitchCompany, useGame } from '../store/game';
import { PaperNoise } from '../desk/Atmosphere';
import { MAX_FILE_BYTES } from '../xlsx/limits';

/** At most this many findings are typed on the sheet; the downloaded report has them all. */
export const REPORT_LINES = 120;

const ORDER = { error: 0, warning: 1, info: 2 } as const;

/** Red ink stamp for errors, amber for warnings, pencil for notes (defaults applied). */
const STAMP = {
  error: { color: '#8a1818', border: '2px solid #8a1818', font: 'font-type font-bold', tilt: -4 },
  warning: { color: '#7a4a00', border: '2px solid #7a4a00', font: 'font-type font-bold', tilt: 3 },
  info: { color: '#4a4a4a', border: '1px dashed #6a6a6a', font: 'font-hand text-[18px] font-semibold italic', tilt: 0 },
} as const;

/** The findings in reading order: errors, then warnings, then notes (each in file order). */
export function sortedIssues(report: ImportReport): ImportIssue[] {
  return report.issues.map((issue, i) => ({ issue, i })).sort((a, b) => ORDER[a.issue.severity] - ORDER[b.issue.severity] || a.i - b.i).map((x) => x.issue);
}

/** Where a finding is: "OpenOrders!C7 · Open sales orders" (the workbook when it has no sheet). */
export function issuePlace(t: Translator, i: ImportIssue): string {
  if (i.sheet === null) return t.t('ui.archive.report.workbook');
  const spec = TEMPLATE.sheets.find((s) => s.name === i.sheet);
  return spec ? `${cellRef(i)} · ${t.t(spec.labelKey)}` : cellRef(i);
}

/** The column of a finding: "Column: Customer code (customer_id)", or null. */
export function issueColumn(t: Translator, i: ImportIssue): string | null {
  if (i.column === null) return null;
  const col = TEMPLATE.sheets.find((s) => s.name === i.sheet)?.columns.find((c) => c.key === i.column);
  return t.t('ui.archive.report.column', { label: col ? t.t(col.labelKey) : i.column, key: i.column });
}

function IssueLine({ i }: { i: ImportIssue }) {
  const t = useT();
  const s = STAMP[i.severity];
  const column = issueColumn(t, i);
  return (
    <li className="report-row grid grid-cols-[82px_1fr] gap-x-2.5 py-1.5" data-testid="issue" data-severity={i.severity} data-code={i.code}>
      <span
        className={`mt-0.5 self-start justify-self-start px-1 text-label uppercase leading-tight tracking-[.06em] ${s.font}`}
        style={{ color: s.color, border: s.border, transform: `rotate(${s.tilt}deg)` }}
      >
        {t.t(`import.severity.${i.severity}`)}
      </span>
      <div className="min-w-0 font-type text-label leading-snug">
        <div className="font-bold" data-testid="issue-place">
          {issuePlace(t, i)}
        </div>
        {column && (
          <div className="text-ink-muted" data-testid="issue-column">
            {column}
          </div>
        )}
        <div data-testid="issue-message">{t.t(i.code, i.params)}</div>
        {i.value !== undefined && i.value !== null && <div className="break-words text-ink-muted">{t.t('ui.archive.report.value', { value: String(i.value) })}</div>}
      </div>
    </li>
  );
}

function Counts({ report }: { report: ImportReport }) {
  const t = useT();
  const { errors, warnings, info, rows } = report.summary;
  const sheets = Object.keys(rows).length;
  const total = Object.values(rows).reduce((a, b) => a + b, 0);
  return (
    <div data-testid="report-summary">
      <div className="flex flex-wrap gap-2.5 font-type text-label font-bold">
        <span className="border-2 border-[#8a1818] px-1.5 text-[#8a1818]" data-testid="count-errors">
          {t.plural('ui.archive.report.errors', errors)}
        </span>
        <span className="border-2 border-[#7a4a00] px-1.5 text-[#7a4a00]" data-testid="count-warnings">
          {t.plural('ui.archive.report.warnings', warnings)}
        </span>
        <span className="border border-dashed border-[#6a6a6a] px-1.5 text-[#4a4a4a]" data-testid="count-info">
          {t.plural('ui.archive.report.info', info)}
        </span>
      </div>
      <p className="m-0 mt-1 font-type text-label text-ink-muted">
        {report.snapshotDate ? t.t('ui.archive.report.rows', { sheets, rows: total, date: report.snapshotDate }) : t.t('ui.archive.report.rowsNoDate', { sheets, rows: total })}
      </p>
      <p className="m-0 mt-0.5 font-type text-label font-bold" style={{ color: errors ? '#8a1818' : '#1f5a34' }} data-testid="report-verdict">
        {t.t(errors ? 'ui.archive.report.blocked' : 'ui.archive.report.clean')}
      </p>
    </div>
  );
}

const button = 'press min-h-touch cursor-pointer rounded-sm border-2 px-3 font-type text-label font-bold disabled:cursor-not-allowed disabled:opacity-50';

/** The typed inspection report of the last file read, on paper. */
export function InspectionReport() {
  const t = useT();
  const inspection = useArchive((s) => s.inspection);
  const ready = useArchive(importReady);
  const pending = useArchive((s) => s.pending);
  const downloading = useArchive((s) => s.downloading);
  const download = useArchive((s) => s.download);
  const requestImport = useArchive((s) => s.requestImport);
  const free = useGame(canSwitchCompany);

  let body;
  if (inspection.status === 'idle') {
    body = (
      <p className="m-0 mt-4 font-hand text-[21px] font-semibold italic leading-snug" style={{ color: '#5a2a14' }} data-testid="report-placeholder">
        {t.t('ui.archive.report.placeholder')}
      </p>
    );
  } else if (inspection.status === 'reading') {
    body = (
      <p className="m-0 mt-4 font-type text-label" role="status">
        {t.t('ui.archive.upload.reading', { name: inspection.fileName })}
      </p>
    );
  } else if (inspection.status === 'failed') {
    body = (
      <div className="mt-3" role="alert" data-testid="read-failure" data-failure={inspection.failure}>
        <p className="m-0 font-type text-label font-bold text-oxblood-ink">{t.t('ui.archive.read.title', { name: inspection.fileName })}</p>
        <p className="m-0 mt-1 font-type text-label leading-snug">{t.t(`ui.archive.read.${inspection.failure}`, { mb: MAX_FILE_BYTES / (1024 * 1024) })}</p>
      </div>
    );
  } else {
    const issues = sortedIssues(inspection.report);
    const more = issues.length - REPORT_LINES;
    body = (
      <>
        <div className="mt-2">
          <Counts report={inspection.report} />
        </div>
        <ol className="telegram-scroll m-0 mt-2 min-h-0 flex-1 list-none overflow-y-auto pl-0 pr-1" tabIndex={0} aria-label={t.t('ui.archive.report.heading')} data-testid="issues">
          {issues.slice(0, REPORT_LINES).map((i, n) => (
            <IssueLine key={n} i={i} />
          ))}
          {more > 0 && <li className="py-1.5 font-type text-label text-ink-muted">{t.plural('ui.archive.report.more', more)}</li>}
        </ol>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={`${button} border-ink bg-transparent text-ink`} disabled={downloading !== null} onClick={() => void download('reportXlsx')} aria-label={t.t('ui.archive.report.download.aria', { format: 'xlsx' })} data-testid="report-download-xlsx">
            {t.t('ui.archive.report.download.xlsx')}
          </button>
          <button type="button" className={`${button} border-ink bg-transparent text-ink`} disabled={downloading !== null} onClick={() => void download('reportCsv')} aria-label={t.t('ui.archive.report.download.aria', { format: 'csv' })} data-testid="report-download-csv">
            {t.t('ui.archive.report.download.csv')}
          </button>
          <button
            type="button"
            className={`${button} ml-auto border-[#1f3a28] bg-[#1f3a28] text-cream-2`}
            disabled={!ready || !free}
            onClick={requestImport}
            data-testid="import-button"
          >
            {t.t(inspection.imported ? 'ui.archive.report.imported' : pending === 'import' ? 'ui.archive.report.importing' : 'ui.archive.report.import')}
          </button>
        </div>
      </>
    );
  }

  return (
    <article
      aria-labelledby="inspection-title"
      className="paper on-paper absolute left-[962px] top-[156px] z-10 flex h-[540px] w-[442px] flex-col px-5 pb-3.5 pt-4"
      style={{ transform: 'rotate(.4deg)', boxShadow: '0 2px 3px rgba(0,0,0,.4),0 26px 44px rgba(0,0,0,.65)' }}
      data-testid="inspection-report"
      data-status={inspection.status}
    >
      <PaperNoise id="paper-inspection" />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <h2 id="inspection-title" className="m-0 font-display text-[28px] font-extrabold leading-tight">
          {t.t('ui.archive.report.heading')}
        </h2>
        {(inspection.status === 'ready' || inspection.status === 'failed') && (
          <p className="m-0 truncate font-type text-label text-ink-muted" title={inspection.fileName} data-testid="report-file">
            {inspection.fileName}
          </p>
        )}
        <div className="mt-1.5 h-1.5 border-b border-t-[3px] border-ink" />
        {body}
      </div>
    </article>
  );
}
