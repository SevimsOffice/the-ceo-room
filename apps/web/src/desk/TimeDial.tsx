import { useT } from '../i18n';
import { useGame } from '../store/game';

/** Pointer angle of the dial knob per mode. */
const POINTER = { idle: 0, week: -50, month: 50, play: 110 } as const;

/** A small brass dial beside the bell: +1 week, +1 month, and play / pause. */
export function TimeDial() {
  const t = useT();
  const ready = useGame((s) => s.phase === 'ready');
  const busy = useGame((s) => s.busy);
  const pending = useGame((s) => s.advancePending);
  const fatal = useGame((s) => s.fatal !== null);
  const playing = useGame((s) => s.playing);
  const report = useGame((s) => s.report);
  const advance = useGame((s) => s.advance);
  const play = useGame((s) => s.play);
  const pause = useGame((s) => s.pause);

  const jump = busy ? busy.toDay - busy.fromDay : 0;
  const mode: keyof typeof POINTER = playing ? 'play' : jump >= 30 ? 'month' : jump >= 7 ? 'week' : 'idle';
  const running = playing || busy !== null;
  const jumpDisabled = !ready || running || pending || fatal;
  const status = busy && !playing ? t.t('ui.dial.running', { day: busy.toDay }) : playing ? t.t('ui.dial.playing') : t.t('ui.dial.idle');

  const tab =
    'press flex h-touch w-full cursor-pointer items-center justify-center rounded-[3px] font-type text-label font-bold disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <section
      aria-labelledby="dial-heading"
      className="absolute left-[981px] top-[652px] z-10 w-[204px] rounded border border-brass-edge bg-panel px-3 pb-3 pt-2.5"
      style={{ boxShadow: '0 10px 20px rgba(0,0,0,.5)' }}
      data-testid="time-dial"
    >
      <div className="flex items-start gap-2.5">
        <svg width="52" height="52" viewBox="0 0 60 60" aria-hidden="true" className="shrink-0">
          <defs>
            <radialGradient id="dial-knob" cx="35%" cy="30%" r="80%">
              <stop offset="0" stopColor="#fbe9ae" />
              <stop offset=".45" stopColor="#c19a43" />
              <stop offset="1" stopColor="#5a3f10" />
            </radialGradient>
          </defs>
          <circle cx="30" cy="30" r="28" fill="#1a0c06" stroke="#7a5c20" />
          {[-50, 0, 50, 110].map((a) => (
            <line key={a} x1="30" y1="5" x2="30" y2="10" stroke="#e0bd6a" strokeWidth="2" transform={`rotate(${a} 30 30)`} />
          ))}
          <circle cx="30" cy="30" r="19" fill="url(#dial-knob)" stroke="#3d2a0a" />
          <g className="needle" style={{ transform: `rotate(${POINTER[mode]}deg)`, transformOrigin: '30px 30px' }}>
            <line x1="30" y1="30" x2="30" y2="14" stroke="#2a1a08" strokeWidth="3" strokeLinecap="round" />
          </g>
        </svg>
        <div className="min-w-0 flex-1">
          <h2 id="dial-heading" className="m-0 font-type text-label uppercase tracking-[.14em] text-[#d9c9a4]">
            {t.t('ui.dial.heading')}
          </h2>
          <p className="m-0 mt-0.5 min-h-[40px] font-type text-label text-[#d9c9a4]" aria-live="polite" data-testid="dial-status">
            {status}
          </p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" className={`${tab} brass`} disabled={jumpDisabled} aria-label={t.t('ui.dial.week.aria')} onClick={() => advance(7)} data-testid="advance-week">
          {t.t('ui.dial.week')}
        </button>
        <button type="button" className={`${tab} brass`} disabled={jumpDisabled} aria-label={t.t('ui.dial.month.aria')} onClick={() => advance(30)} data-testid="advance-month">
          {t.t('ui.dial.month')}
        </button>
      </div>
      <button
        type="button"
        className={`${tab} mt-2 border ${running ? 'border-[#c9a24e] bg-[#6a2428] text-cream-2' : 'border-brass-edge bg-[#2a1710] text-brass-text hover:bg-[#3a2016]'}`}
        disabled={!ready || !report || fatal}
        aria-label={running ? t.t('ui.dial.pause.aria') : t.t('ui.dial.play.aria')}
        aria-pressed={playing}
        onClick={() => (running ? pause() : play())}
        data-testid="play-pause"
      >
        <PlayGlyph pause={running} />
        {running ? t.t('ui.dial.pause') : t.t('ui.dial.play')}
      </button>
    </section>
  );
}

/** Play triangle or pause bars, drawn (no font glyphs); the button carries the accessible name. */
function PlayGlyph({ pause }: { pause: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="mr-2 shrink-0" data-testid="play-glyph">
      {pause ? (
        <>
          <rect x="2" y="1.5" width="3.5" height="11" fill="currentColor" />
          <rect x="8.5" y="1.5" width="3.5" height="11" fill="currentColor" />
        </>
      ) : (
        <path d="M3 1.5 L12.5 7 L3 12.5 Z" fill="currentColor" />
      )}
    </svg>
  );
}
