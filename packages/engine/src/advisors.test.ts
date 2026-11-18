/**
 * Rule-based advisors (SIMULATION_DESIGN §6): different objectives → different recommendations from
 * the same numbers; every citation is a real selector value; each role stays inside its scope.
 */
import { describe, expect, it } from 'vitest';
import { STEEL_DECISION, STEEL_OPTIONS, day1State, engineAt } from '../test/seedFixture';
import { citedField, resolveCitation } from '../test/citations';
import { ADVISOR_SCOPE, type AdvisorBrief, type AdvisorRole, selectAdvisorBrief, selectDecision } from './index';
import { CFO_CASH_TOLERANCE } from './rules/advisors';

const ROLES: readonly AdvisorRole[] = ['cfo', 'coo'];
const brief = (role: AdvisorRole): AdvisorBrief => {
  const b = selectAdvisorBrief(day1State(), role, STEEL_DECISION);
  if (!b) throw new Error(`no ${role} brief`);
  return b;
};
const impacts = () => {
  const i = selectDecision(day1State(), STEEL_DECISION)?.impacts;
  if (!i) throw new Error('no impacts');
  return i;
};
const d30 = (optionId: string) => impacts().options.find((o) => o.optionId === optionId)?.horizons.find((h) => h.horizonDays === 30);

describe('CFO and COO on the steel decision', () => {
  it('recommend different options: CFO → B (switch), COO → A (negotiate)', () => {
    expect(brief('cfo').recommendedOptionId).toBe('switch');
    expect(brief('coo').recommendedOptionId).toBe('negotiate');
    expect(brief('cfo').recommendedOptionId).not.toBe(brief('coo').recommendedOptionId);
  });

  it.each(ROLES)('%s: every citation equals the value the cited selector returns', (role) => {
    const b = brief(role);
    expect(b.citations.length).toBeGreaterThan(0);
    for (const c of b.citations) {
      const actual = resolveCitation(day1State(), c.selector);
      expect(actual, c.selector).not.toBeUndefined();
      expect(actual, c.selector).toEqual(c.value);
    }
  });

  it.each(ROLES)('%s: cites only figures inside its scope', (role) => {
    for (const c of brief(role).citations) expect(ADVISOR_SCOPE[role].reads, c.selector).toContain(citedField(c.selector));
  });

  it.each(ROLES)('%s: ranks every option once, rank 1 = recommendation, rationale and assumptions match', (role) => {
    const b = brief(role);
    expect(b.ranking.map((r) => r.optionId).sort()).toEqual([...STEEL_OPTIONS].sort());
    expect(b.ranking.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(b.ranking[0]?.optionId).toBe(b.recommendedOptionId);
    expect(b.rationale.params.optionId).toBe(b.recommendedOptionId);
    const opt = day1State().decisions.find((d) => d.id === STEEL_DECISION)?.options.find((o) => o.id === b.recommendedOptionId);
    expect(b.assumptions).toEqual(expect.arrayContaining(opt?.assumptions ?? []));
    const head = day1State().departments.find((d) => d.id === ADVISOR_SCOPE[role].departmentId)?.headName;
    expect(b.advisorName).toBe(head);
  });

  it('CFO is grounded in cash: its pick has the best +30 minimum-cash delta (within its tie tolerance)', () => {
    const best = Math.max(...STEEL_OPTIONS.map((o) => d30(o)?.delta.minCash ?? -Infinity));
    const pick = d30(brief('cfo').recommendedOptionId)?.delta.minCash ?? -Infinity;
    expect(pick).toBeGreaterThanOrEqual(best - CFO_CASH_TOLERANCE);
    expect(brief('cfo').rationale.params.minCashDelta).toBe(pick);
    // and it does NOT pick the option with the delayed cash hit
    expect(brief('cfo').recommendedOptionId).not.toBe('negotiate');
    expect(d30('negotiate')?.delta.minCash).toBeLessThan(-CFO_CASH_TOLERANCE);
  });

  it('COO is grounded in delivery: its pick has the least +30 delivery slip, and the CFO pick slips', () => {
    const slip = (o: string) => d30(o)?.delta.deliverySlipDays ?? Infinity;
    const pick = brief('coo').recommendedOptionId;
    for (const o of STEEL_OPTIONS) expect(slip(pick)).toBeLessThanOrEqual(slip(o));
    expect(slip(brief('cfo').recommendedOptionId)).toBeGreaterThan(slip(pick));
    expect(brief('coo').rationale.params.slipDelta).toBe(slip(pick));
  });

  it('give no brief once the decision is closed, or for an unknown decision', () => {
    const e = engineAt();
    e.dispatch({ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'switch' });
    for (const role of ROLES) {
      expect(selectAdvisorBrief(e.state(), role, STEEL_DECISION)).toBeNull();
      expect(selectAdvisorBrief(day1State(), role, 'dec-9999')).toBeNull();
    }
  });
});

describe('advisors on the Day-9 discount decision', () => {
  it.each(ROLES)('%s: briefs an option of the decision with resolvable citations', (role) => {
    const e = engineAt();
    e.advance(8);
    const s = e.state();
    const b = selectAdvisorBrief(s, role, 'dec-0002');
    if (!b) throw new Error('no brief');
    expect(['grant', 'refuse']).toContain(b.recommendedOptionId);
    for (const c of b.citations) expect(resolveCitation(s, c.selector), c.selector).toEqual(c.value);
    for (const c of b.citations) expect(ADVISOR_SCOPE[role].reads, c.selector).toContain(citedField(c.selector));
  });
});
