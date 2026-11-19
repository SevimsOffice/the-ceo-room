import { useT } from '../i18n';
import { useGame } from '../store/game';

/** Screen-reader announcement of the new day, and a paper slip for anything that went wrong. */
export function StatusSlip() {
  const t = useT();
  const report = useGame((s) => s.report);
  const notice = useGame((s) => s.notice);
  return (
    <>
      <p className="sr-only" aria-live="polite" data-testid="day-announcement">
        {report ? t.t('ui.status.newDay', { day: report.day, weekday: t.t(report.weekdayCode) }) : t.t('ui.status.loading')}
      </p>
      {notice && (
        <p
          role="status"
          className="on-paper absolute bottom-[34px] left-[61px] z-20 m-0 w-[290px] px-4 py-3 font-type text-[13px] leading-snug"
          style={{ background: '#e4d3a4', color: '#241a10', transform: 'rotate(-1deg)', boxShadow: '0 10px 18px rgba(0,0,0,.5)' }}
          data-testid="status-slip"
        >
          {t.t(notice.key, { reason: t.msg(notice.detail) })}
        </p>
      )}
    </>
  );
}
