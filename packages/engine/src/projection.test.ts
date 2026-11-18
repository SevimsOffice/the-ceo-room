/**
 * Projections are honest: the Decision Room preview (+7 / +30) is exactly what happens when the CEO
 * approves and advances, and previewing never touches the live state.
 */
import { describe, expect, it } from 'vitest';
import { STEEL_DECISION, STEEL_OPTIONS, day1State, engineAt } from '../test/seedFixture';
import {
  type Command,
  projectState,
  projectedRunway,
  selectAdvisorBrief,
  selectDecision,
  selectMorningReport,
  selectOrderImpact,
  snapshotKpis,
  stateHash,
} from './index';

const approve = (optionId: string): Command => ({ type: 'approveOption', decisionId: STEEL_DECISION, optionId });

describe('impact preview = actual outcome', () => {
  const impacts = selectDecision(day1State(), STEEL_DECISION)?.impacts;
  if (!impacts) throw new Error('no impacts on Day 1');
  const startDay = day1State().day;

  it('previews every option at +7 and +30 without errors', () => {
    expect(impacts.horizons).toEqual([7, 30]);
    expect(impacts.options.map((o) => o.optionId)).toEqual([...STEEL_OPTIONS]);
    for (const o of impacts.options) {
      expect(o.error).toBeNull();
      expect(o.horizons.map((h) => h.horizonDays)).toEqual([7, 30]);
    }
  });

  it.each(STEEL_OPTIONS)('%s: approve + advance gives exactly the previewed KPIs at +7 and +30', (optionId) => {
    const opt = impacts.options.find((o) => o.optionId === optionId);
    const at = (h: number) => opt?.horizons.find((x) => x.horizonDays === h);
    const e = engineAt();
    expect(e.dispatch(approve(optionId)).ok).toBe(true);
    e.advance(7);
    expect(snapshotKpis(e.state(), startDay)).toEqual(at(7)?.option);
    e.advance(23);
    const actual30 = snapshotKpis(e.state(), startDay);
    expect(actual30).toEqual(at(30)?.option);
    expect(actual30.cash).toBe(at(30)?.option.cash);
    expect(actual30.grossMarginBps).toBe(at(30)?.option.grossMarginBps);
  });

  it('baseline preview = leaving the decision open (it expires to the default)', () => {
    const e = engineAt();
    e.advance(7);
    expect(snapshotKpis(e.state(), startDay)).toEqual(impacts.baseline.find((b) => b.horizonDays === 7)?.kpis);
    e.advance(23);
    expect(snapshotKpis(e.state(), startDay)).toEqual(impacts.baseline.find((b) => b.horizonDays === 30)?.kpis);
  });

  it('delta = option − baseline, and matches two live runs', () => {
    const live = (cmd: Command | null) => {
      const e = engineAt();
      if (cmd) e.dispatch(cmd);
      e.advance(30);
      return e.state();
    };
    const base = live(null);
    for (const o of impacts.options) {
      const h30 = o.horizons.find((h) => h.horizonDays === 30);
      const s = live(approve(o.optionId));
      expect(s.cash - base.cash, o.optionId).toBe(h30?.delta.cash);
      expect(h30?.delta.cash).toBe((h30?.option.cash ?? 0) - (h30?.baseline.cash ?? 0));
      expect(h30?.delta.grossMarginBps).toBe((h30?.option.grossMarginBps ?? 0) - (h30?.baseline.grossMarginBps ?? 0));
    }
  });

  it('engine.project() ends in the very state that approve + advance(30) produces', () => {
    for (const optionId of STEEL_OPTIONS) {
      const e = engineAt();
      const p = e.project([approve(optionId)], 30, [7, 30]);
      if (!p.ok) throw new Error(p.error.code);
      expect(p.checkpoints.map((c) => c.days)).toEqual([7, 30]);
      e.dispatch(approve(optionId));
      e.advance(30);
      expect(stateHash(p.state)).toBe(stateHash(e.state()));
      expect(p.toDay).toBe(e.state().day);
    }
  });

  it('the requested 90-day analysis is also what actually happens', () => {
    const e = engineAt();
    e.dispatch({ type: 'requestAnalysis', decisionId: STEEL_DECISION });
    e.advance(1);
    const ext = selectDecision(e.state(), STEEL_DECISION)?.analysis?.extended;
    const h90 = ext?.options.find((o) => o.optionId === 'negotiate')?.horizons.find((h) => h.horizonDays === 90);
    if (!h90) throw new Error('no 90-day analysis');
    const from = e.state().day;
    e.dispatch(approve('negotiate'));
    e.advance(90);
    expect(snapshotKpis(e.state(), from)).toEqual(h90.option);
  });
});

describe('projections never mutate the live state', () => {
  it('engine.project() leaves hash, ledger and save log untouched', () => {
    const e = engineAt();
    const h = stateHash(e.state());
    const json = JSON.stringify(e.state());
    const ledgerLen = e.ledger().length;
    const log = JSON.stringify(e.snapshot());
    for (const optionId of STEEL_OPTIONS) {
      const p = e.project([approve(optionId)], 30, [7, 30]);
      expect(p.ok).toBe(true);
    }
    expect(e.project([{ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'nope' }], 30).ok).toBe(false);
    expect(stateHash(e.state())).toBe(h);
    expect(JSON.stringify(e.state())).toBe(json);
    expect(e.ledger().length).toBe(ledgerLen);
    expect(JSON.stringify(e.snapshot())).toBe(log);
    // the decision is still open and can be decided
    expect(e.dispatch(approve('negotiate')).ok).toBe(true);
  });

  it('selectors, advisors and projections run on a deep-frozen Day-1 state (any write would throw)', () => {
    const s = day1State();
    expect(Object.isFrozen(s.orders[0])).toBe(true);
    const h = stateHash(s);
    expect(() => {
      selectMorningReport(s);
      selectDecision(s, STEEL_DECISION);
      selectAdvisorBrief(s, 'cfo', STEEL_DECISION);
      selectAdvisorBrief(s, 'coo', STEEL_DECISION);
      selectOrderImpact(s, 'ord-0015');
      projectedRunway(s);
      projectState(s, [approve('switch')], 45, [7, 30, 45]);
    }).not.toThrow();
    expect(stateHash(s)).toBe(h);
  });
});

describe('projected cash runway is honest', () => {
  it('cash stays ≥ 0 until the reported first negative day, then goes below zero, with no decisions', () => {
    const rw = selectMorningReport(day1State()).runway;
    expect(rw.capped).toBe(false);
    expect(rw.firstNegativeDay).toBe(day1State().day + rw.days);
    const e = engineAt();
    e.advance(rw.days + 1); // records the KPI row of the first negative day
    const rows = e.state().daily;
    const neg = rows.find((k) => k.day === rw.firstNegativeDay);
    expect(neg?.cash).toBeLessThan(0);
    for (const k of rows.filter((x) => x.day < (rw.firstNegativeDay ?? 0))) expect(k.cash, `day ${k.day}`).toBeGreaterThanOrEqual(0);
  });
});
