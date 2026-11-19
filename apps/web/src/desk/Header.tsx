import type { Locale } from '@ceo-room/i18n';
import { useT } from '../i18n';
import { useGame } from '../store/game';
import { decisionNumber } from './figures';

const LOCALES: Locale[] = ['tr', 'en'];

/** The two rooms as tabs while a decision is open in the Decision Room (keyboard: Tab + Enter). */
function RoomTabs() {
  const t = useT();
  const view = useGame((s) => s.view);
  const room = useGame((s) => s.room);
  const showDesk = useGame((s) => s.showDesk);
  const showRoom = useGame((s) => s.showRoom);
  // while a decision is being sent the room stays in front (the tabs keep focus, but do nothing)
  const locked = room?.pending != null;
  if (!room) return null;
  const n = decisionNumber(room.decisionId);
  const tab = (active: boolean) =>
    `press flex h-touch items-center rounded-md px-5 font-display text-base font-bold tracking-[.03em] aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${
      active ? 'bg-[#e6d9b8] text-[#2a1c10] shadow-[0_3px_8px_rgba(0,0,0,.5)]' : 'border border-brass-edge bg-[#2a1710] text-brass-text hover:bg-[#3a2016]'
    }`;
  return (
    <nav aria-label={t.t('ui.tabs.label')} className="flex gap-2">
      <button
        type="button"
        className={tab(view === 'desk')}
        aria-current={view === 'desk' ? 'page' : undefined}
        aria-disabled={locked || undefined}
        onClick={() => !locked && showDesk()}
        data-testid="tab-desk"
      >
        {t.t('ui.room.desk')}
      </button>
      <button
        type="button"
        className={tab(view === 'room')}
        aria-current={view === 'room' ? 'page' : undefined}
        aria-disabled={locked || undefined}
        onClick={() => !locked && showRoom()}
        data-testid="tab-room"
      >
        {t.t('ui.tabs.room', { n })}
      </button>
    </nav>
  );
}

/** Top strip: brass name plate, the room's name (and room tabs), today's date, language switch, new game. */
export function Header() {
  const t = useT();
  const view = useGame((s) => s.view);
  const report = useGame((s) => s.report);
  const locale = useGame((s) => s.locale);
  const setLocale = useGame((s) => s.setLocale);
  // a new game can be asked for while loading or after a failure, but not while a day is running
  const running = useGame((s) => s.fatal === null && (s.busy !== null || s.advancePending));
  const askNewGame = useGame((s) => s.askNewGame);

  return (
    <header className="absolute left-0 top-0 z-20 flex h-[72px] w-[1440px] items-center justify-between px-[61px]">
      <div className="flex items-baseline gap-6">
        <div className="brass rounded-[3px] px-5 py-[9px] font-display text-base font-extrabold tracking-[.24em]">{t.t('ui.brand')}</div>
        <h1 className="m-0 font-display text-[22px] font-medium italic text-cream-2" data-testid="room-name">
          {t.t(view === 'room' ? 'ui.room.decision' : 'ui.room.desk')}
        </h1>
      </div>
      <RoomTabs />
      <div className="flex items-center gap-[14px]">
        {report && (
          <span className="font-type text-label text-[#e9dcc0]" data-testid="header-day">
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
                className={`press flex h-touch min-w-touch items-center justify-center rounded-md px-2 font-type text-label font-bold ${
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
          onClick={askNewGame}
          disabled={running}
          data-testid="new-game"
          className="press flex h-touch items-center rounded-md border border-brass-edge bg-[#2a1710] px-4 font-display text-base font-bold tracking-[.03em] text-brass-text hover:bg-[#3a2016] disabled:opacity-50"
        >
          {t.t('ui.newGame.button')}
        </button>
      </div>
    </header>
  );
}
