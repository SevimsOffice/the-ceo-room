import type { Locale } from '@ceo-room/i18n';
import { useT } from '../i18n';
import { useGame } from '../store/game';

const LOCALES: Locale[] = ['tr', 'en'];

/** Top strip: brass name plate, the room's name, today's date, language switch, new game. */
export function Header({ onNewGame }: { onNewGame: () => void }) {
  const t = useT();
  const report = useGame((s) => s.report);
  const locale = useGame((s) => s.locale);
  const setLocale = useGame((s) => s.setLocale);
  const busy = useGame((s) => s.busy);
  const ready = useGame((s) => s.phase === 'ready');

  return (
    <header className="absolute left-0 top-0 z-20 flex h-[72px] w-[1440px] items-center justify-between px-[61px]">
      <div className="flex items-baseline gap-6">
        <div className="brass rounded-[3px] px-5 py-[9px] font-display text-base font-extrabold tracking-[.24em]">{t.t('ui.brand')}</div>
        <h1 className="m-0 font-display text-[22px] font-medium italic text-cream-2">{t.t('ui.room.desk')}</h1>
      </div>
      <div className="flex items-center gap-[14px]">
        {report && (
          <span className="font-type text-[15px] text-[#e9dcc0]" data-testid="header-day">
            {t.t('ui.header.day', { day: report.day, weekday: t.t(report.weekdayCode) })}
          </span>
        )}
        <div role="group" aria-label={t.t('ui.locale.group')} className="flex gap-1.5">
          {LOCALES.map((l) => {
            const active = l === locale;
            return (
              <button
                key={l}
                type="button"
                lang={l}
                aria-pressed={active}
                aria-label={t.t(`ui.locale.${l}.name`)}
                onClick={() => setLocale(l)}
                className={`press flex h-11 min-w-11 items-center justify-center rounded-md px-2 font-type text-sm font-bold ${
                  active ? 'brass' : 'border border-brass-edge bg-[#2a1710] text-brass-text hover:bg-[#3a2016]'
                }`}
              >
                {t.t(`ui.locale.${l}`)}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onNewGame}
          disabled={!ready || busy !== null}
          className="press flex h-11 items-center rounded-md border border-brass-edge bg-[#2a1710] px-4 font-display text-[15px] font-bold tracking-[.03em] text-brass-text hover:bg-[#3a2016] disabled:opacity-50"
        >
          {t.t('ui.newGame.button')}
        </button>
      </div>
    </header>
  );
}
