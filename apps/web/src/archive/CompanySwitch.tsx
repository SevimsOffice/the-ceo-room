import { useT } from '../i18n';
import { useArchive } from '../store/archive';
import { canSwitchCompany, useGame } from '../store/game';
import type { CompanyId } from './protocol';

/**
 * The brass two-way switch: the sample company or My company on the desk. My company is enabled
 * once an Excel file has been imported; each side keeps its own save game.
 */
export function CompanySwitch() {
  const t = useT();
  const company = useGame((s) => s.company);
  const mine = useGame((s) => s.myCompany);
  const free = useGame(canSwitchCompany);
  const pending = useArchive((s) => s.pending);
  const switchCompany = useArchive((s) => s.switchCompany);
  const side = (id: CompanyId, label: string, enabled: boolean) => {
    const on = company === id;
    return (
      <button
        type="button"
        aria-pressed={on}
        disabled={!enabled}
        onClick={() => void switchCompany(id)}
        className={`press flex h-touch min-w-0 items-center justify-center rounded-[3px] px-3 font-display text-base font-bold leading-tight disabled:opacity-55 ${
          on ? 'brass' : 'border border-brass-edge bg-[#2a1710] text-brass-text hover:bg-[#3a2016]'
        }`}
        data-testid={`switch-${id}`}
      >
        {label}
      </button>
    );
  };
  const note = pending === 'switch' ? 'ui.archive.switch.switching' : !mine ? 'ui.archive.switch.mineDisabled' : !free ? 'ui.archive.switch.busy' : null;
  return (
    <section
      aria-labelledby="switch-title"
      className="absolute left-[476px] top-[90px] z-10 w-[460px] rounded-[4px] px-3.5 pb-2.5 pt-2"
      style={{ background: 'linear-gradient(180deg,#3a2213,#2a170c)', boxShadow: 'inset 0 0 0 1px #7a5c20, 0 14px 24px rgba(0,0,0,.6)' }}
      data-testid="company-switch"
    >
      <h2 id="switch-title" className="m-0 font-type text-label font-bold uppercase tracking-[.14em] text-brass-text">
        {t.t('ui.archive.switch.label')}
      </h2>
      <div role="group" aria-labelledby="switch-title" className="mt-1.5 grid grid-cols-[1fr_44px_auto] items-center gap-2">
        {side('sample', t.t('ui.archive.switch.sample'), free && pending === null)}
        {/* the lever, thrown towards the company on the desk */}
        <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r="13" fill="#2a1a08" stroke="#c19a43" strokeWidth="3" />
          <g style={{ transform: `rotate(${company === 'mine' ? 35 : -35}deg)`, transformOrigin: '22px 22px', transition: 'transform 500ms ease' }}>
            <rect x="19.5" y="3" width="5" height="21" rx="2.5" fill="#dcb862" stroke="#5e4210" />
            <circle cx="22" cy="4" r="4.5" fill="#ecd084" stroke="#5e4210" />
          </g>
        </svg>
        {side('mine', t.t('ui.archive.switch.mine'), mine !== null && free && pending === null)}
      </div>
      <p className="m-0 mt-1 min-h-[20px] font-type text-label leading-tight text-[#e9dcc0]" role="status" data-testid="switch-note">
        {note ? t.t(note) : ''}
      </p>
    </section>
  );
}
