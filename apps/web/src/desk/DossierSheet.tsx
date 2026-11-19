import type { Translator } from '@ceo-room/i18n';
import { formatBps, formatInt } from '@ceo-room/i18n';
import { useT } from '../i18n';
import { useGame } from '../store/game';
import { Sheet } from './Sheet';
import { daysLeftText, decisionNumber } from './figures';

/** How each supporting figure (selectDecision) is printed. */
function figureText(t: Translator, code: string, value: number): string {
  switch (code) {
    case 'figure.cash':
    case 'figure.backlogValue':
    case 'figure.affectedOrderValue':
      return t.money(value);
    case 'figure.runwayDays':
      return t.t('ui.runway.days', { days: value });
    case 'figure.grossMarginBps':
      return formatBps(value, t.locale, 1);
    default:
      return formatInt(value, t.locale);
  }
}

/** A decision's dossier, read-only: the decision itself is taken in the Decision Room (next milestone). */
export function DossierSheet() {
  const t = useT();
  const dossier = useGame((s) => s.dossier);
  const close = useGame((s) => s.closeDossier);
  if (!dossier) return null;
  const v = dossier.view;
  const n = decisionNumber(dossier.decisionId);

  return (
    <Sheet title={t.t('ui.dossier.heading', { n })} onClose={close} width={760} testId="dossier">
      {!dossier.loaded && <p className="font-type text-sm text-ink-muted">{t.t('ui.dossier.loading')}</p>}
      {dossier.loaded && v && (
        <div className="font-type text-[15px] leading-relaxed text-ink">
          <h3 className="m-0 mt-4 font-display text-lg font-bold">{t.t(`ui.decision.title.${v.kind}`)}</h3>
          <p className="m-0 mt-1 font-type text-sm font-bold" style={{ color: v.status === 'open' && v.daysLeft <= 1 ? '#8a1818' : '#4a3a28' }}>
            {v.status === 'open' ? daysLeftText(t, v.daysLeft) : t.t('ui.dossier.closed')}
          </p>

          <h4 className="m-0 mt-4 font-type text-[13px] uppercase tracking-[.1em] text-ink-muted">{t.t('ui.dossier.situation')}</h4>
          <p className="m-0 mt-1" data-testid="dossier-situation">
            {t.msg(v.situation)}
          </p>

          <h4 className="m-0 mt-4 font-type text-[13px] uppercase tracking-[.1em] text-ink-muted">{t.t('ui.dossier.figures')}</h4>
          <div className="mt-1">
            {v.figures.map((f) => (
              <div key={f.code} className="report-row flex items-end justify-between gap-4 py-1.5">
                <span className="text-[13px] uppercase tracking-[.06em] text-ink-muted">{t.t(f.code)}</span>
                <span className="font-bold">{figureText(t, f.code, f.value)}</span>
              </div>
            ))}
          </div>

          <h4 className="m-0 mt-4 font-type text-[13px] uppercase tracking-[.1em] text-ink-muted">{t.t('ui.dossier.options')}</h4>
          <ol className="m-0 mt-1 list-[upper-alpha] pl-7" data-testid="dossier-options">
            {v.options.map((o) => (
              <li key={o.id} className="py-0.5">
                {t.t(o.labelKey)}
                {o.id === v.defaultOptionId && <span className="ml-2 text-[13px] italic text-ink-muted">({t.t('ui.dossier.defaultOption')})</span>}
              </li>
            ))}
          </ol>
          {v.status === 'open' && <p className="m-0 mt-3 text-[13px] text-ink-muted">{t.t('ui.dossier.deadline', { day: v.deadlineDay })}</p>}

          <p className="m-0 mt-5 font-hand text-[21px] font-semibold italic leading-snug" style={{ color: '#5a2a14' }} data-testid="dossier-room-note">
            {t.t('ui.dossier.roomNote')}
          </p>
        </div>
      )}
    </Sheet>
  );
}
