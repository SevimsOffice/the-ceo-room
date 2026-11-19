/** Resolve an advisor citation `{ selector, value }` against the real selectors. */
import { type CompanyState, selectDecision, selectDecisionOutlook, selectMorningReport } from '../src/index';

function path(obj: unknown, parts: string[]): unknown {
  let cur = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Supported forms (the ones the V1 advisors emit):
 *   selectMorningReport.<path>
 *   selectDecision(<id>).options[<optionId>].d<H>.<path into HorizonImpact>   (H = 7, 30)
 *   selectDecision(<id>).baseline.d<H>.<path into KpiSnapshot>
 *   selectDecisionOutlook(<id>).… the same paths, H = 7, 30, 90
 */
export function resolveCitation(s: CompanyState, selector: string): unknown {
  if (selector.startsWith('selectMorningReport.')) {
    return path(selectMorningReport(s), selector.slice('selectMorningReport.'.length).split('.'));
  }
  const m = /^(selectDecision|selectDecisionOutlook)\(([^)]+)\)\.(.+)$/.exec(selector);
  if (!m) return undefined;
  const id = m[2] ?? '';
  const impacts = m[1] === 'selectDecision' ? selectDecision(s, id)?.impacts : selectDecisionOutlook(s, id);
  if (!impacts) return undefined;
  const [head, horizon, ...rest] = (m[3] ?? '').split('.');
  const h = Number(/^d(\d+)$/.exec(horizon ?? '')?.[1]);
  const opt = /^options\[(.+)\]$/.exec(head ?? '');
  if (opt) {
    const hz = impacts.options.find((o) => o.optionId === opt[1])?.horizons.find((x) => x.horizonDays === h);
    return path(hz, rest);
  }
  if (head === 'baseline') return path(impacts.baseline.find((b) => b.horizonDays === h)?.kpis, rest);
  return undefined;
}

/** The KPI field a citation reads (used to check advisor scope). */
export function citedField(selector: string): string {
  if (selector.startsWith('selectMorningReport.')) return selector.split('.')[1] ?? '';
  const parts = selector.replace(/^selectDecision(?:Outlook)?\([^)]+\)\./, '').split('.');
  const afterHorizon = parts.slice(2);
  const first = afterHorizon[0];
  return (first === 'delta' || first === 'option' || first === 'baseline' ? afterHorizon[1] : first) ?? '';
}
