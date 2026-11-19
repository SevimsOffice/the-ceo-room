import { useT } from '../i18n';
import { currentRunway, useGame } from '../store/game';
import { Sheet } from './Sheet';
import { daysLeftText, decisionNumber, figureText, runwayText } from './figures';

function FigureRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="report-row flex items-end justify-between gap-4 py-1.5" data-testid={testId}>
      <span className="uppercase tracking-[.04em] text-ink-muted">{label}</span>
      <span className="font-bold" data-testid={testId ? `${testId}-value` : undefined}>
        {value}
      </span>
    </div>
  );
}

/** A decision's dossier, read-only: the decision itself is taken in the Decision Room (button). */
export function DossierSheet() {
  const t = useT();
  const dossier = useGame((s) => s.dossier);
  const close = useGame((s) => s.closeDossier);
  const openRoom = useGame((s) => s.openRoom);
  // the runway is the live projection the report shows (capped: "180+ gün"), not a dossier figure
  const live = useGame(currentRunway);
  if (!dossier) return null;
  const v = dossier.view;
  const n = decisionNumber(dossier.decisionId);

  return (
    <Sheet title={t.t('ui.dossier.heading', { n })} onClose={close} width={760} testId="dossier">
      {!dossier.loaded && <p className="font-type text-label text-ink-muted">{t.t('ui.dossier.loading')}</p>}
      {dossier.loaded && v && (
        <div className="font-type text-label leading-relaxed text-ink">
          <h3 className="m-0 mt-4 font-display text-lg font-bold">{t.t(`ui.decision.title.${v.kind}`)}</h3>
          <p className="m-0 mt-1 font-type text-label font-bold" style={{ color: v.status === 'open' && v.daysLeft <= 1 ? '#8a1818' : '#4a3a28' }}>
            {v.status === 'open' ? daysLeftText(t, v.daysLeft) : t.t('ui.dossier.closed')}
          </p>

          <h4 className="m-0 mt-4 font-type text-label uppercase tracking-[.08em] text-ink-muted">{t.t('ui.dossier.situation')}</h4>
          <p className="m-0 mt-1" data-testid="dossier-situation">
            {t.msg(v.situation)}
          </p>

          <h4 className="m-0 mt-4 font-type text-label uppercase tracking-[.08em] text-ink-muted">{t.t('ui.dossier.figures')}</h4>
          <div className="mt-1">
            {v.figures.flatMap((f) => {
              const row = <FigureRow key={f.code} label={t.t(f.code)} value={figureText(t, f.code, f.value)} />;
              // the projected runway goes right after the cash, as in the morning report
              if (f.code !== 'figure.cash') return [row];
              return [row, <FigureRow key="figure.runwayDays" label={t.t('figure.runwayDays')} value={runwayText(t, live?.runway ?? null)} testId="dossier-runway" />];
            })}
          </div>

          <h4 className="m-0 mt-4 font-type text-label uppercase tracking-[.08em] text-ink-muted">{t.t('ui.dossier.options')}</h4>
          <ol className="m-0 mt-1 list-[upper-alpha] pl-7" data-testid="dossier-options">
            {v.options.map((o) => (
              <li key={o.id} className="py-0.5">
                {t.t(o.labelKey)}
                {o.id === v.defaultOptionId && <span className="ml-2 text-label italic text-ink-muted">({t.t('ui.dossier.defaultOption')})</span>}
              </li>
            ))}
          </ol>
          {v.status === 'open' && <p className="m-0 mt-3 text-label text-ink-muted">{t.t('ui.dossier.deadline', { day: v.deadlineDay })}</p>}

          {v.status === 'open' && (
            <div className="mt-5 flex items-center gap-5">
              <button
                type="button"
                onClick={() => openRoom(v.id)}
                className="press min-h-touch shrink-0 cursor-pointer rounded-sm border-2 border-oxblood bg-oxblood px-5 font-display text-lg font-bold text-cream-2 hover:bg-[#7d2a2f]"
                data-testid="dossier-open-room"
              >
                {t.t('ui.dossier.openRoom')}
              </button>
              <p className="m-0 font-hand text-[21px] font-semibold italic leading-snug" style={{ color: '#5a2a14' }} data-testid="dossier-room-note">
                {t.t('ui.dossier.roomNote')}
              </p>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
