import type { PendingDecision } from '@ceo-room/engine';
import { useT } from '../i18n';
import { useGame } from '../store/game';
import { daysLeftText, decisionNumber } from './figures';

/** Manila, oxblood and bottle-green folders, in turn. */
const FOLDERS = [
  { bg: '#cdac6b', fg: '#2a1c10' },
  { bg: '#6a2428', fg: '#f1e4c6' },
  { bg: '#2f4a3a', fg: '#efe4c4' },
] as const;
const TILT = [-1.2, 0.9, -0.7];

/** Who the decision is about: the supplier or the customer named in its situation. */
function counterpartyParam(d: PendingDecision): { key: string; id: string } | null {
  const p = d.situation.params;
  if (typeof p.supplierId === 'string') return { key: 'supplier', id: p.supplierId };
  if (typeof p.customerId === 'string') return { key: 'customer', id: p.customerId };
  return null;
}

/** Pending decisions as folders on the left of the desk; each opens a read-only dossier. */
export function DecisionFolders() {
  const t = useT();
  const pending = useGame((s) => s.report?.pendingDecisions ?? null);
  const directory = useGame((s) => s.directory);
  const openDossier = useGame((s) => s.openDossier);
  if (!pending) return null;
  const step = pending.length <= 1 ? 0 : Math.min(92, 196 / (pending.length - 1));

  return (
    <section aria-labelledby="decisions-heading" className="w-[290px]">
      <h2 id="decisions-heading" className="brass m-0 inline-block rounded-[3px] px-4 py-1.5 font-display text-sm font-bold tracking-[.08em]">
        {t.t('ui.decisions.heading')}
      </h2>
      <div className="relative mt-10 h-[350px]">
        {pending.length === 0 && (
          <p className="m-0 max-w-[260px] font-hand text-xl font-semibold italic leading-snug text-cream-2" data-testid="no-decisions">
            {t.t('ui.decisions.none')}
          </p>
        )}
        {pending.map((d, i) => {
          const c = FOLDERS[i % FOLDERS.length]!;
          const title = t.t(`ui.decision.title.${d.kind}`);
          const who = counterpartyParam(d);
          const whoName = who ? ((who.key === 'supplier' ? directory?.suppliers[who.id] : directory?.customers[who.id]) ?? who.id) : '';
          const n = decisionNumber(d.id);
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => openDossier(d.id)}
              aria-label={t.t('ui.folder.open', { title: `${t.t('ui.folder.number', { n })} ${title}` })}
              className="press absolute block h-[150px] w-[276px] cursor-pointer border-0 bg-transparent p-0 text-left transition-transform hover:-translate-y-1"
              style={{ left: i % 2 === 0 ? 0 : 8, top: i * step, transform: `rotate(${TILT[i % TILT.length]}deg)`, zIndex: i + 1 }}
              data-testid="decision-folder"
            >
              <span className="absolute left-[18px] top-[-21px] h-[22px] w-32 rounded-t-md" style={{ background: c.bg }} aria-hidden="true" />
              <span
                className="absolute inset-0 box-border block rounded-b rounded-tr-md px-4 py-3.5"
                style={{ background: c.bg, color: c.fg, boxShadow: '0 -2px 8px rgba(0,0,0,.35),0 12px 20px rgba(0,0,0,.5)' }}
              >
                <span className="block font-type text-xs tracking-[.08em]">{t.t('ui.folder.number', { n })}</span>
                <span className="mt-1 block font-display text-lg font-bold leading-tight">{title}</span>
                <span className="mt-0.5 block truncate font-type text-[13px]">{whoName}</span>
                <span className="mt-2 block font-type text-[13px] font-bold">{daysLeftText(t, d.daysLeft)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
