import { useEffect, useRef } from 'react';
import { useT } from '../i18n';
import { useGame } from '../store/game';

/**
 * A typed error slip laid on the desk when the engine fails (worker exception or crash). Its one
 * action starts a new game; the saved game is kept as a backup first (store.newGame).
 */
export function FatalSlip() {
  const t = useT();
  const fatal = useGame((s) => s.fatal);
  const newGame = useGame((s) => s.newGame);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (fatal) button.current?.focus();
  }, [fatal]);
  if (!fatal) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(10,4,2,.62)' }}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fatal-title"
        aria-describedby="fatal-body"
        className="paper on-paper w-[560px] px-10 pb-8 pt-8"
        style={{ transform: 'rotate(-.6deg)', boxShadow: '0 2px 3px rgba(0,0,0,.4),0 30px 60px rgba(0,0,0,.75)' }}
        data-testid="fatal-slip"
      >
        <h2 id="fatal-title" className="m-0 font-display text-[28px] font-extrabold leading-tight">
          {t.t('ui.fatal.title')}
        </h2>
        <div className="mt-3 h-1.5 border-b border-t-[3px] border-ink" />
        <p id="fatal-body" className="m-0 mt-4 font-type text-label leading-relaxed">
          {t.t('ui.fatal.body', { reason: t.msg(fatal) })}
        </p>
        <div className="mt-6 flex justify-end">
          <button
            ref={button}
            type="button"
            onClick={newGame}
            className="press min-h-touch cursor-pointer rounded-sm border-2 border-[#6a1c1f] bg-[#6a1c1f] px-5 font-type text-label font-bold text-cream-2 hover:bg-[#7d2a2f]"
            data-testid="fatal-new-game"
          >
            {t.t('ui.fatal.newGame')}
          </button>
        </div>
      </div>
    </div>
  );
}
