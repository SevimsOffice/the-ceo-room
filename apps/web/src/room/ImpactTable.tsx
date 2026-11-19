import type { HorizonImpact } from '@ceo-room/engine';
import { useT } from '../i18n';
import { TONE_COLOR } from '../desk/TypedReport';
import { METRICS, deltaCell, horizonHeading, metricLabel } from './impact';

/**
 * The +7 / +30 (and, once analysed, +90) changes of one course of action against the baseline,
 * as typed ledger rows: cash, margin, delivery, customers, overtime, turnover, risk. Every cell is
 * an engine figure (HorizonImpact.delta / risk); the row headers name the unit for screen readers.
 */
export function ImpactTable({ horizons, today, testId }: { horizons: readonly HorizonImpact[]; today: number; testId?: string }) {
  const t = useT();
  // two horizons fit "+7 gün / Gün 8" headings; with +90 the columns are narrower: "+7" under
  // a "days ahead" note, the day for screen readers only, monospace set a little tighter
  const wide = horizons.length <= 2;
  const cols = `${wide ? 76 : 70}px repeat(${horizons.length}, minmax(0, 1fr))`;
  return (
    <table className={`w-full border-collapse font-type text-label text-ink ${wide ? '' : 'tracking-[-0.04em]'}`} data-testid={testId}>
      <thead>
        <tr className="grid gap-x-1 border-b-2 border-ink pb-1" style={{ gridTemplateColumns: cols }}>
          <th className="p-0 text-left font-normal leading-tight text-ink-muted">
            <span className="sr-only">{t.t('ui.room.table.metric')}</span>
            {!wide && <span aria-hidden="true">{t.t('ui.room.table.daysAhead')}</span>}
          </th>
          {horizons.map((h) => {
            const head = horizonHeading(t, h.horizonDays, today);
            return (
              <th key={h.horizonDays} scope="col" className="p-0 text-right font-bold leading-tight text-ink" data-testid="impact-horizon">
                {wide ? (
                  <>
                    <span className="block">{head.title}</span>
                    <span className="block font-normal text-ink-muted">{head.day}</span>
                  </>
                ) : (
                  <>
                    <span aria-hidden="true">{t.t('ui.room.horizonShort', { days: h.horizonDays })}</span>
                    <span className="sr-only">
                      {head.title} ({head.day})
                    </span>
                  </>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {METRICS.map((m) => {
          const label = metricLabel(t, m);
          return (
            <tr key={m} className="grid items-baseline gap-x-1 border-b border-dotted border-[rgba(60,40,20,.55)] py-[3px]" style={{ gridTemplateColumns: cols }} data-metric={m}>
              <th scope="row" className="p-0 text-left font-normal leading-tight text-ink-muted">
                <span aria-hidden="true">{t.t(`ui.room.short.${m}`)}</span>
                <span className="sr-only">
                  {label.label} ({label.unit})
                </span>
              </th>
              {horizons.map((h) => {
                const c = deltaCell(t, m, h);
                return (
                  <td
                    key={h.horizonDays}
                    className={`p-0 text-right font-bold leading-tight ${wide ? 'text-[17px]' : ''}`}
                    style={{ color: TONE_COLOR[c.tone] }}
                    data-testid={`cell-${m}-${h.horizonDays}`}
                  >
                    {c.text}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
