/**
 * Rule-based advisors (SIMULATION_DESIGN §6): different objectives → different recommendations from
 * the same numbers; every citation is a real selector value; each role stays inside its scope.
 */
import { describe, expect, it } from 'vitest';
import { STEEL_DECISION, STEEL_OPTIONS, day1State, engineAt } from '../test/seedFixture';
import { citedField, resolveCitation } from '../test/citations';
import {
  ADVISOR_SCOPE,
  type AdvisorBrief,
  type AdvisorRole,
  CFO_CASH_TOLERANCE,
  type CfoRow,
  type CompanyState,
  type CooRow,
  rankCfo,
  rankCoo,
  projectState,
  selectAdvisorBrief,
  selectDecision,
  selectDecisionOutlook,
  tl,
} from './index';

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
const outlook = () => {
  const i = selectDecisionOutlook(day1State(), STEEL_DECISION);
  if (!i) throw new Error('no outlook');
  return i;
};
const d90 = (optionId: string) => outlook().options.find((o) => o.optionId === optionId)?.horizons.find((h) => h.horizonDays === 90);
/** The CFO's cash key (ADR-0007): the worse of the +30 and +90 minimum-cash deltas. */
const cfoCash = (o: string) => Math.min(d30(o)?.delta.minCash ?? -Infinity, d90(o)?.delta.minCash ?? -Infinity);
/** The COO's slip key: the worse of the +30 and +90 delivery-slip deltas. */
const cooSlip = (o: string) => Math.max(d30(o)?.delta.deliverySlipDays ?? Infinity, d90(o)?.delta.deliverySlipDays ?? Infinity);

describe('CFO and COO on the steel decision', () => {
  // 90-day outlook (ADR-0007): B (switch) still wins on the +30 view, but its bills and slip after
  // Day 30 cost more cash than absorbing, so the CFO now recommends absorb and says so.
  it('recommend different options: CFO → absorb (B = switch at +30 only), COO → A (negotiate)', () => {
    expect(brief('cfo').recommendedOptionId).toBe('absorb');
    expect(brief('cfo').thirtyDayPick).toBe('switch');
    expect(brief('cfo').pickChanged).toBe(true);
    expect(brief('coo').recommendedOptionId).toBe('negotiate');
    expect(brief('coo').thirtyDayPick).toBe('negotiate');
    expect(brief('coo').pickChanged).toBe(false);
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

  it('CFO is grounded in cash: its pick has the best worse-of(+30, +90) minimum-cash delta (within its tie tolerance)', () => {
    const best = Math.max(...STEEL_OPTIONS.map(cfoCash));
    const pick = cfoCash(brief('cfo').recommendedOptionId);
    expect(pick).toBeGreaterThanOrEqual(best - CFO_CASH_TOLERANCE);
    expect(brief('cfo').rationale.params.minCashDelta).toBe(pick);
    expect(brief('cfo').rationale.params.minCashDelta30).toBe(d30(brief('cfo').recommendedOptionId)?.delta.minCash);
    expect(brief('cfo').rationale.params.minCashDelta90).toBe(d90(brief('cfo').recommendedOptionId)?.delta.minCash);
    // on the +30 view alone the same rule picks the option with the best +30 minimum cash (switch)
    const best30 = Math.max(...STEEL_OPTIONS.map((o) => d30(o)?.delta.minCash ?? -Infinity));
    expect(d30(brief('cfo').thirtyDayPick)?.delta.minCash).toBeGreaterThanOrEqual(best30 - CFO_CASH_TOLERANCE);
    // … whose +90 minimum cash is worse than absorbing: the reason the pick changed
    expect(d90('switch')?.delta.minCash).toBeLessThan(-CFO_CASH_TOLERANCE);
    // and it does NOT pick the option with the delayed cash hit
    expect(brief('cfo').recommendedOptionId).not.toBe('negotiate');
    expect(d30('negotiate')?.delta.minCash).toBeLessThan(-CFO_CASH_TOLERANCE);
  });

  it('COO is grounded in delivery: its pick has the least worse-of(+30, +90) slip, and the CFO’s +30 pick slips', () => {
    const pick = brief('coo').recommendedOptionId;
    for (const o of STEEL_OPTIONS) expect(cooSlip(pick)).toBeLessThanOrEqual(cooSlip(o));
    expect(cooSlip(brief('cfo').thirtyDayPick)).toBeGreaterThan(cooSlip(pick));
    expect(d30(brief('cfo').thirtyDayPick)?.delta.deliverySlipDays).toBeGreaterThan(d30(pick)?.delta.deliverySlipDays ?? Infinity);
    expect(brief('coo').rationale.params.slipDelta).toBe(cooSlip(pick));
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

describe('CFO ranking: tolerance is a distance from the best, not a rounding bucket (review fix 4)', () => {
  const T = CFO_CASH_TOLERANCE;
  const ids = (r: { optionId: string }[]): string[] => r.map((x) => x.optionId);

  it('1 kuruş apart across an old bucket boundary is a tie, so margin decides', () => {
    // old key Math.round(minCash / T) put these in buckets 1 and 0 and ranked A first on cash alone
    expect(Math.round(T / 2 / T)).not.toBe(Math.round((T / 2 - 1) / T));
    const r = rankCfo([
      { optionId: 'A', minCash: T / 2, grossMarginBps: 0 },
      { optionId: 'B', minCash: T / 2 - 1, grossMarginBps: 100 },
    ]);
    expect(ids(r)).toEqual(['B', 'A']);
    expect(r.map((x) => x.rank)).toEqual([1, 2]);
  });

  it('exactly the tolerance apart is a tie; one kuruş more is not', () => {
    const at = (gap: number) =>
      ids(
        rankCfo([
          { optionId: 'cash', minCash: 0, grossMarginBps: 0 },
          { optionId: 'margin', minCash: -gap, grossMarginBps: 500 },
        ]),
      );
    expect(at(T)).toEqual(['margin', 'cash']);
    expect(at(T + 1)).toEqual(['cash', 'margin']);
    // close to each other but not to the best: not tied with each other's bucket, ranked by cash
    expect(
      ids(
        rankCfo([
          { optionId: 'best', minCash: 5 * T, grossMarginBps: -900 },
          { optionId: 'x', minCash: 2 * T, grossMarginBps: 0 },
          { optionId: 'y', minCash: 2 * T - 1, grossMarginBps: 900 },
        ]),
      ),
    ).toEqual(['best', 'x', 'y']);
  });

  it('ties keep option order when margin is also equal; empty input ranks nothing', () => {
    expect(
      ids(
        rankCfo([
          { optionId: 'p', minCash: -3, grossMarginBps: 10 },
          { optionId: 'q', minCash: 0, grossMarginBps: 10 },
          { optionId: 'r', minCash: -T, grossMarginBps: 10 },
        ]),
      ),
    ).toEqual(['p', 'q', 'r']);
    expect(rankCfo([])).toEqual([]);
  });
});

describe('COO ranking keys (review fix 6)', () => {
  const row = (optionId: string, o: Partial<CooRow> = {}): CooRow => ({
    optionId,
    deliverySlipDays: 0,
    lateOrders: 0,
    overtimeHours: 0,
    coverage7: 0,
    coverage30: 0,
    ...o,
  });
  const ids = (r: { optionId: string }[]): string[] => r.map((x) => x.optionId);

  it('slip, then late orders, then any extra overtime, then +7 and +30 coverage', () => {
    expect(ids(rankCoo([row('a', { deliverySlipDays: 1 }), row('b', { lateOrders: 5 })]))).toEqual(['b', 'a']);
    expect(ids(rankCoo([row('a', { lateOrders: 1 }), row('b', { overtimeHours: 50 })]))).toEqual(['b', 'a']);
    expect(ids(rankCoo([row('a', { overtimeHours: 1, coverage7: 99 }), row('b', { overtimeHours: 0 })]))).toEqual(['b', 'a']);
    // any increase in overtime counts the same; coverage decides between them
    expect(ids(rankCoo([row('a', { overtimeHours: 5 }), row('b', { overtimeHours: 50, coverage7: 3 })]))).toEqual(['b', 'a']);
    expect(ids(rankCoo([row('a', { coverage7: 10, coverage30: 0 }), row('b', { coverage7: 10, coverage30: 1 })]))).toEqual(['b', 'a']);
    expect(ids(rankCoo([row('a'), row('b')]))).toEqual(['a', 'b']);
  });
});

describe('a brief can be recomputed from its citations alone (review fix 6)', () => {
  /** Parse `selectDecision(id).options[opt].d<H>.<path>` citations into per-option values. */
  const cited = (b: AdvisorBrief): Map<string, Map<string, number>> => {
    const out = new Map<string, Map<string, number>>();
    for (const c of b.citations) {
      const m = /^selectDecision(?:Outlook)?\([^)]+\)\.options\[([^\]]+)\]\.(d\d+)\.(?:delta|option)\.(.+)$/.exec(c.selector);
      if (!m) continue;
      const [, opt = '', h = '', key = ''] = m;
      const k = `${h}.${key.replace(/^coverageDays\..*$/, 'coverage')}`;
      const per = out.get(opt) ?? new Map<string, number>();
      if (per.has(k)) throw new Error(`cited twice: ${c.selector}`);
      per.set(k, Number(c.value));
      out.set(opt, per);
    }
    return out;
  };
  const need = (m: Map<string, number> | undefined, k: string): number => {
    const v = m?.get(k);
    if (v === undefined) throw new Error(`ranking key ${k} not cited`);
    return v;
  };

  const cases: [string, () => Readonly<CompanyState>, string][] = [
    ['steel, Day 1', () => day1State(), STEEL_DECISION],
    [
      'discount, Day 9',
      () => {
        const e = engineAt();
        e.advance(8);
        return e.state();
      },
      'dec-0002',
    ],
  ];

  it.each(cases)('CFO on %s', (_, state, decisionId) => {
    const s = state();
    const b = selectAdvisorBrief(s, 'cfo', decisionId);
    if (!b) throw new Error('no brief');
    const c = cited(b);
    const options = b.ranking.map((r) => r.optionId);
    const rows: CfoRow[] = options.map((id) => ({
      optionId: id,
      minCash: Math.min(need(c.get(id), 'd30.minCash'), need(c.get(id), 'd90.minCash')),
      grossMarginBps: need(c.get(id), 'd30.grossMarginBps'),
    }));
    expect(rankCfo(rows)).toEqual(b.ranking);
    // and by hand: among options within the tolerance of the best minimum cash, the best margin
    const best = Math.max(...rows.map((r) => r.minCash));
    const tied = rows.filter((r) => best - r.minCash <= CFO_CASH_TOLERANCE);
    const top = Math.max(...tied.map((r) => r.grossMarginBps));
    expect(tied.find((r) => r.grossMarginBps === top)?.optionId).toBe(b.recommendedOptionId);
  });

  it.each(cases)('COO on %s', (_, state, decisionId) => {
    const s = state();
    const b = selectAdvisorBrief(s, 'coo', decisionId);
    if (!b) throw new Error('no brief');
    const c = cited(b);
    const withMaterial = typeof s.decisions.find((d) => d.id === decisionId)?.situation.params.materialId === 'string';
    const rows: CooRow[] = b.ranking.map(({ optionId: id }) => ({
      optionId: id,
      deliverySlipDays: Math.max(need(c.get(id), 'd30.deliverySlipDays'), need(c.get(id), 'd90.deliverySlipDays')),
      lateOrders: Math.max(need(c.get(id), 'd30.lateOrders'), need(c.get(id), 'd90.lateOrders')),
      overtimeHours: Math.max(need(c.get(id), 'd30.overtimeHours'), need(c.get(id), 'd90.overtimeHours')),
      coverage7: withMaterial ? need(c.get(id), 'd7.coverage') : 0,
      coverage30: withMaterial ? need(c.get(id), 'd30.coverage') : 0,
    }));
    expect(rankCoo(rows)).toEqual(b.ranking);
    // and by hand: lexicographic minimum of the cited keys
    const key = (r: CooRow): number[] => [r.deliverySlipDays, r.lateOrders, r.overtimeHours > 0 ? 1 : 0, -r.coverage7, -r.coverage30];
    const byHand = [...rows].sort((x, y) => {
      const a = key(x);
      const z = key(y);
      for (let i = 0; i < a.length; i++) if ((a[i] ?? 0) !== (z[i] ?? 0)) return (a[i] ?? 0) - (z[i] ?? 0);
      return 0;
    });
    expect(byHand[0]?.optionId).toBe(b.recommendedOptionId);
  });
});

describe('90-day outlook: bills that fall due after the +30 view (deferred payables)', () => {
  it('the Decision Room stays at +7 / +30; the outlook adds +90 with identical +7 / +30 figures', () => {
    expect(impacts().horizons).toEqual([7, 30]);
    expect(outlook().horizons).toEqual([7, 30, 90]);
    for (const o of STEEL_OPTIONS) expect(d30(o)).toEqual(outlook().options.find((x) => x.optionId === o)?.horizons.find((h) => h.horizonDays === 30));
    const e = engineAt();
    e.dispatch({ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'absorb' });
    expect(selectDecisionOutlook(e.state(), STEEL_DECISION)).toBeNull();
  });

  it('payablesDue windows tile the horizon: [Day 1, 7], [8, 30], [31, 90]; absorb (= baseline) adds nothing', () => {
    const windows = (o: string) => outlook().options.find((x) => x.optionId === o)?.horizons.map((h) => [h.payablesDue.fromDay, h.payablesDue.toDay]);
    for (const o of STEEL_OPTIONS) expect(windows(o)).toEqual([[1, 7], [8, 30], [31, 90]]);
    for (const h of outlook().options.find((x) => x.optionId === 'absorb')?.horizons ?? []) {
      expect(h.payablesDue.delta).toBe(0);
      expect(h.payablesDue.firstExtraDueDay).toBeNull();
    }
    for (const o of outlook().options) for (const h of o.horizons) expect(h.payablesDue.option - h.payablesDue.baseline).toBe(h.payablesDue.delta);
    // switch pays its deposit up front: extra bills in the first week from Day 1
    expect(outlook().options.find((x) => x.optionId === 'switch')?.horizons[0]?.payablesDue.firstExtraDueDay).toBe(1);
  });

  it('the +90 window equals the projected supplier bills due on Days 31–90, option minus baseline', () => {
    const s = day1State();
    const due = (cmds: Parameters<typeof projectState>[1]) => {
      const p = projectState(s, cmds, 90);
      if (!p.ok) throw new Error(p.error.code);
      return p.state.payables.filter((x) => x.status !== 'cancelled' && x.dueDay >= 31 && x.dueDay <= 90).reduce((t, x) => t + x.amount, 0);
    };
    const base = due([]);
    for (const o of STEEL_OPTIONS) {
      const pd = d90(o)?.payablesDue;
      expect(pd?.baseline).toBe(base);
      expect(pd?.option).toBe(due([{ type: 'approveOption', decisionId: STEEL_DECISION, optionId: o }]));
    }
  });

  it.each(ROLES)('%s surfaces switch’s deferred bills (8.41M TRY from Day 32) as data and as a caveat', (role) => {
    const b = brief(role);
    expect(b.horizons).toEqual([7, 30, 90]);
    expect(b.deferred).toEqual([{ optionId: 'switch', amount: tl(8_410_000), firstDueDay: 32 }]);
    expect(b.deferred[0]?.amount).toBe(d90('switch')?.payablesDue.delta);
    expect(b.deferred[0]?.firstDueDay).toBe(d90('switch')?.payablesDue.firstExtraDueDay);
    // every option with extra bills after +30 is listed, none without
    const extra = STEEL_OPTIONS.filter((o) => (d90(o)?.payablesDue.delta ?? 0) > 0);
    expect(b.deferred.map((x) => x.optionId).sort()).toEqual([...extra].sort());
    expect(b.caveats).toContainEqual({ code: 'advisor.caveat.deferredPayables', params: { optionId: 'switch', amount: tl(8_410_000), fromDay: 32 } });
    // the figures behind the caveat are cited and resolve
    const cited = b.citations.filter((c) => c.selector.includes('.payablesDue.'));
    expect(cited.map((c) => c.selector)).toEqual([
      `selectDecisionOutlook(${STEEL_DECISION}).options[switch].d90.payablesDue.delta`,
      `selectDecisionOutlook(${STEEL_DECISION}).options[switch].d90.payablesDue.firstExtraDueDay`,
    ]);
    for (const c of cited) expect(resolveCitation(day1State(), c.selector)).toEqual(c.value);
  });

  it('the CFO says when +90 changed her pick; the COO’s pick holds and says nothing', () => {
    expect(brief('cfo').caveats).toContainEqual({ code: 'advisor.caveat.pickChangedAt90', params: { thirtyDayOptionId: 'switch', optionId: 'absorb', horizonDays: 90 } });
    expect(brief('coo').caveats.map((c) => c.code)).toEqual(['advisor.caveat.deferredPayables']);
  });

  it('rankCfo on worse-of keys: an option best at +30 but dipping at +90 drops behind a steady one', () => {
    const T = CFO_CASH_TOLERANCE;
    const row = (optionId: string, m30: number, m90: number, margin: number): CfoRow => ({ optionId, minCash: Math.min(m30, m90), grossMarginBps: margin });
    expect(rankCfo([row('steady', 0, 0, 0), row('late-dip', 5 * T, -3 * T, 900)]).map((r) => r.optionId)).toEqual(['steady', 'late-dip']);
    expect(rankCfo([row('steady', 0, 0, 0), row('late-dip', 5 * T, -T, 900)]).map((r) => r.optionId)).toEqual(['late-dip', 'steady']);
  });
});
