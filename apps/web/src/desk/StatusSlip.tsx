import { useT } from '../i18n';
import { useGame } from '../store/game';

/** Screen-reader announcement of the new day, and a paper slip for anything that went wrong. */
export function StatusSlip() {
  const t = useT();
  const report = useGame((s) => s.report);
  const notice = useGame((s) => s.notice);
  const dismiss = useGame((s) => s.dismissNotice);
  return (
    <>
      <p className="sr-only" aria-live="polite" data-testid="day-announcement">
        {report ? t.t('ui.status.newDay', { day: report.day, weekday: t.t(report.weekdayCode) }) : t.t('ui.status.loading')}
      </p>
      {notice && (
        <div
          role="status"
          className="on-paper absolute bottom-[34px] left-[61px] z-20 w-[290px] px-4 py-3 font-type text-label leading-snug"
          style={{ background: '#e4d3a4', color: '#241a10', transform: 'rotate(-1deg)', boxShadow: '0 10px 18px rgba(0,0,0,.5)' }}
          data-testid="status-slip"
        >
          <p className="m-0">{t.t(notice.key, { reason: t.msg(notice.detail) })}</p>
          <button
            type="button"
            onClick={dismiss}
            className="press mt-2 min-h-touch cursor-pointer rounded-sm border-2 border-ink bg-transparent px-3 font-type text-label font-bold uppercase tracking-[.12em] text-ink"
          >
            {t.t('ui.sheet.close')}
          </button>
        </div>
      )}
    </>
  );
}
