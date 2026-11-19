import { formatBps } from '@ceo-room/i18n';
import { useT } from '../i18n';
import { currentRunway, useGame } from '../store/game';
import { BrassGauge } from './BrassGauge';
import { runwayText } from './figures';

/** Capacity and projected cash runway gauges on a small walnut panel. */
export function GaugePanel() {
  const t = useT();
  const report = useGame((s) => s.report);
  const live = useGame(currentRunway);
  const thresholds = useGame((s) => s.thresholds);
  if (!report) return null;
  const cap = report.capacityUtilisationBps;
  const capText = formatBps(cap, t.locale);
  // warning zone: from the engine's comfort threshold up to 100%
  const comfort = thresholds?.capacityComfortBps ?? 10000;
  const runway = live?.runway ?? null;
  const rText = runwayText(t, runway);
  return (
    <div className="flex w-[290px] gap-3 rounded border border-brass-edge bg-panel p-3.5" style={{ boxShadow: '0 10px 20px rgba(0,0,0,.5)' }}>
      <BrassGauge
        id="gauge-capacity"
        testId="gauge-capacity"
        label={t.t('ui.gauge.capacity')}
        value={capText}
        fraction={cap / 10000}
        warn={(i) => i * 1000 >= comfort}
        ariaLabel={t.t('ui.gauge.capacity.aria', { value: capText })}
      />
      <BrassGauge
        id="gauge-runway"
        testId="gauge-runway"
        label={t.t('ui.gauge.runway')}
        value={rText}
        fraction={runway ? (runway.capped ? 1 : runway.days / runway.horizonDays) : null}
        warn={(i) => i <= 1}
        ariaLabel={t.t('ui.gauge.runway.aria', { value: rText })}
      />
    </div>
  );
}
