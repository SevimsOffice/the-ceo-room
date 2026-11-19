import type { CompanyState, Msg } from '../model/types';
import type { SimDay } from '../model/units';
import { RISK_RULES } from '../config/tuning';
import { blockedOrders, deliverySlip } from '../selectors/metrics';
import { turnoverBps } from '../systems/people';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Risk rules live in config/tuning.ts; re-exported here for existing imports. */
export { RISK_RULES };

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  factors: Msg[];
}

export function assessRisk(s: CompanyState, sinceDay: SimDay): RiskAssessment {
  const factors: Msg[] = [];
  const add = (code: string, points: number, params: Msg['params'] = {}): void => {
    factors.push({ code, params: { ...params, points } });
  };
  if (s.cash < 0) add('risk.cashNegative', RISK_RULES.cashNegative, { cash: s.cash });
  else if (s.cash < RISK_RULES.cashLowThreshold) add('risk.cashLow', RISK_RULES.cashLow, { cash: s.cash });
  const slip = deliverySlip(s, sinceDay);
  if (slip.lateOrders >= RISK_RULES.lateOrdersMany.atLeast) add('risk.lateOrders', RISK_RULES.lateOrdersMany.points, { lateOrders: slip.lateOrders });
  else if (slip.lateOrders >= RISK_RULES.lateOrdersSome.atLeast) add('risk.lateOrders', RISK_RULES.lateOrdersSome.points, { lateOrders: slip.lateOrders });
  const blocked = blockedOrders(s);
  if (blocked > 0) add('risk.materialShortage', RISK_RULES.materialShortage, { blockedOrders: blocked });
  const maxChurn = Math.max(0, ...s.customers.filter((c) => c.status === 'active' && c.key).map((c) => c.churnRisk));
  if (maxChurn >= RISK_RULES.churnHigh.atLeastBps) add('risk.customerChurn', RISK_RULES.churnHigh.points, { churnRisk: maxChurn });
  else if (maxChurn >= RISK_RULES.churnElevated.atLeastBps) add('risk.customerChurn', RISK_RULES.churnElevated.points, { churnRisk: maxChurn });
  const to = turnoverBps(s, 'operations');
  if (to >= RISK_RULES.turnoverHigh.atLeastBps) add('risk.turnover', RISK_RULES.turnoverHigh.points, { turnoverBps: to });
  const down = s.lines.filter((l) => l.status === 'down').length;
  if (down > 0) add('risk.lineDown', RISK_RULES.lineDown, { lines: down });
  const score = factors.reduce((t, f) => t + Number(f.params.points), 0);
  const band = RISK_RULES.bands.find((b) => score <= b.maxScore);
  return { score, level: band ? band.level : 'critical', factors };
}
