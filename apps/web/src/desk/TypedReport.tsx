import { useT } from '../i18n';
import { currentRunway, useGame } from '../store/game';
import { PaperNoise } from './Atmosphere';
import { type ReportLine, type Tone, reportLines, reportNote } from './figures';

export const TONE_COLOR: Record<Tone, string> = {
  ink: '#241a10',
  good: '#1f5a34',
  bad: '#8a1818',
  warn: '#7a4a00',
  muted: '#4a3a28',
};

function Line({ line }: { line: ReportLine }) {
  return (
    <>
      <div className="max-w-[200px] pb-1 font-type text-[13px] uppercase leading-tight tracking-[.08em] text-ink-muted">{line.label}</div>
      <div className="text-right">
        <div className="font-type text-[28px] font-bold leading-none text-ink" data-testid={`report-${line.id}-value`}>
          {line.value}
          {line.unit && <span className="text-[14px] font-normal text-ink-muted"> {line.unit}</span>}
        </div>
        <div className="report-hint mt-1.5 font-type text-[13px]" style={{ color: TONE_COLOR[line.tone] }} data-testid={`report-${line.id}-note`}>
          {line.note}
        </div>
      </div>
    </>
  );
}

/** The typed morning report: a cream sheet with a paperclip and a fold line. */
export function TypedReport() {
  const t = useT();
  const report = useGame((s) => s.report);
  const live = useGame(currentRunway);
  const thresholds = useGame((s) => s.thresholds);
  const openOrderBook = useGame((s) => s.openOrderBook);
  if (!report) return null;
  const lines = reportLines(t, report, live, thresholds);
  const weekday = t.t(report.weekdayCode);

  return (
    <article
      aria-labelledby="report-title"
      className="paper on-paper absolute left-[395px] top-[92px] z-10 w-[580px] px-[42px] pb-6 pt-8"
      style={{ transform: 'rotate(-.6deg)', boxShadow: '0 2px 3px rgba(0,0,0,.4),0 26px 44px rgba(0,0,0,.65)' }}
      data-testid="morning-report"
    >
      <PaperNoise id="paper-report" />
      <div className="fold-line pointer-events-none absolute left-0 right-0 top-[48%] h-4" />
      {/* paperclip */}
      <svg className="absolute left-[34px] top-[-16px]" width="26" height="66" viewBox="0 0 26 66" aria-hidden="true">
        <path d="M8 52V13a7 7 0 0 1 14 0v34a4 4 0 0 1-8 0V17" fill="none" stroke="#8d949b" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-display text-[15px] font-bold uppercase tracking-[.22em]">{t.t(report.company.nameKey)}</div>
            <div className="mt-0.5 font-type text-[13px] text-ink-muted">{report.company.city}</div>
          </div>
          <div
            className="border-[3px] border-double border-oxblood-ink px-2.5 py-1 font-type text-xs font-bold uppercase tracking-[.14em] text-oxblood-ink"
            style={{ transform: 'rotate(3deg)' }}
          >
            {t.t('ui.report.stamp')}
          </div>
        </div>
        <h2 id="report-title" className="m-0 mt-3 font-display text-[36px] font-extrabold leading-[1.05]">
          {t.t('ui.report.title')}
        </h2>
        <div className="mt-1.5 font-type text-sm text-ink-muted" data-testid="report-dateline">
          {t.t('ui.report.dateline', { day: report.day, weekday })}
        </div>
        <div className="mt-3 h-1.5 border-b border-t-[3px] border-ink" />
        <div>
          {lines.map((line) =>
            line.id === 'orders' ? (
              <button
                key={line.id}
                type="button"
                onClick={openOrderBook}
                className="report-row report-row-button flex w-full cursor-pointer items-end justify-between gap-3.5 bg-transparent pb-2 pt-2.5 text-left"
                data-testid="report-orders"
              >
                <Line line={line} />
              </button>
            ) : (
              <div key={line.id} className="report-row flex items-end justify-between gap-3.5 pb-2 pt-2.5">
                <Line line={line} />
              </div>
            ),
          )}
        </div>
        <p className="m-0 mt-3 max-w-[420px] font-hand text-[19px] font-semibold italic leading-tight" style={{ color: '#5a2a14' }}>
          {reportNote(t, report.developments.length)}
        </p>
      </div>
      <div className="pointer-events-none absolute bottom-6 right-[34px] h-[84px] w-[84px] rounded-full border-[6px]" style={{ borderColor: 'rgba(110,70,30,.14)' }} />
    </article>
  );
}
