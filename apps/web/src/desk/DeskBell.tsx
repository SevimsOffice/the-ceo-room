import { useState } from 'react';
import { useT } from '../i18n';
import { useGame } from '../store/game';

/** The brass desk bell: ring it to advance one day. */
export function DeskBell() {
  const t = useT();
  const ready = useGame((s) => s.phase === 'ready');
  const busy = useGame((s) => s.busy !== null || s.advancePending || s.fatal !== null);
  const playing = useGame((s) => s.playing);
  const advance = useGame((s) => s.advance);
  const [ring, setRing] = useState(0);
  const disabled = !ready || busy || playing;

  return (
    <button
      type="button"
      aria-label={t.t('ui.bell.aria')}
      disabled={disabled}
      onClick={() => {
        setRing((n) => n + 1);
        advance(1);
      }}
      className="press absolute left-[1189px] top-[668px] z-10 flex w-[190px] cursor-pointer flex-col items-center gap-1.5 border-0 bg-transparent p-0 disabled:opacity-60"
      data-testid="desk-bell"
    >
      <svg key={ring} className={ring > 0 ? 'bell-ring' : ''} width="170" height="124" viewBox="0 0 170 124" aria-hidden="true">
        <defs>
          <radialGradient id="bell-body" cx="34%" cy="28%" r="85%">
            <stop offset="0" stopColor="#fbe9ae" />
            <stop offset=".4" stopColor="#cfa343" />
            <stop offset="1" stopColor="#5a3f10" />
          </radialGradient>
          <linearGradient id="bell-base" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8c6b25" />
            <stop offset="1" stopColor="#3d2a0a" />
          </linearGradient>
        </defs>
        <ellipse cx="85" cy="108" rx="72" ry="11" fill="#000" opacity=".5" />
        <ellipse cx="85" cy="100" rx="70" ry="13" fill="url(#bell-base)" />
        <path d="M22 98 C22 46 48 22 85 22 C122 22 148 46 148 98 Z" fill="url(#bell-body)" />
        <ellipse cx="85" cy="98" rx="63" ry="9" fill="#4a3310" />
        <ellipse cx="62" cy="52" rx="14" ry="26" fill="#fff" opacity=".22" transform="rotate(24 62 52)" />
        <circle cx="85" cy="16" r="8" fill="url(#bell-body)" stroke="#4a3310" />
      </svg>
      <span className="brass block rounded-[3px] px-[18px] py-[7px] font-display text-[17px] font-bold italic">{t.t('ui.bell.label')}</span>
    </button>
  );
}
