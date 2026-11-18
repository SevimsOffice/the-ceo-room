/**
 * Smoke tests for Milestone 1 (the full suite is written separately by test-writer).
 * Uses the committed seed through test/seedFixture.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newEngine, rawSeed, seed } from '../test/seedFixture';
import {
  fromSnapshot,
  selectAdvisorBrief,
  selectDecision,
  selectMorningReport,
  selectOrderImpact,
  stateHash,
  tl,
  validateSeedBundle,
} from './index';

const within = (actual: number, target: number, pct: number): boolean => Math.abs(actual - target) <= Math.abs(target) * pct;

describe('seed', () => {
  it('validates the committed seed', () => {
    expect(validateSeedBundle(rawSeed()).ok).toBe(true);
  });

  it('reports broken references and non-integer money', () => {
    const raw = rawSeed() as { orders: { salesOrders: { customerId: string; unitPrice: number }[] } };
    const first = raw.orders.salesOrders[0];
    if (!first) throw new Error('seed has no orders');
    first.customerId = 'cus_nobody';
    first.unitPrice = 1.5;
    const v = validateSeedBundle(raw);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors.some((e) => e.includes('cus_nobody'))).toBe(true);
      expect(v.errors.some((e) => e.includes('unitPrice'))).toBe(true);
    }
  });
});

describe('Day 1', () => {
  const engine = newEngine();
  const report = selectMorningReport(engine.state());

  it('is calibrated to the design targets (±5%)', () => {
    expect(report.day).toBe(1);
    expect(report.revenue.lastPeriod).toBe(tl(76_400_000));
    expect(report.revenue.changeBps).toBeGreaterThan(550);
    expect(report.cash).toBe(tl(41_200_000));
    expect(report.backlog.openOrders).toBe(15);
    expect(within(report.backlog.value, tl(168_000_000), 0.05)).toBe(true);
    expect(within(report.satisfaction.average, 8100, 0.05)).toBe(true);
    expect(report.satisfaction.change).toBeLessThan(-300);
    expect(within(report.capacityUtilisationBps, 9200, 0.05)).toBe(true);
    expect(report.runway.capped).toBe(false);
    expect(report.runway.days).toBeGreaterThanOrEqual(30);
    expect(report.runway.days).toBeLessThanOrEqual(70);
  });

  it('has two developments: the large order and the steel price rise with a decision', () => {
    expect(report.developments.map((d) => d.cardId)).toEqual(['card_large_order', 'card_steel_price']);
    expect(report.pendingDecisions).toHaveLength(1);
  });

  it('runs the large order through the cross-department pipeline', () => {
    const dev = report.developments[0];
    const view = selectOrderImpact(engine.state(), dev?.orderId ?? '');
    expect(view?.plan).not.toBeNull();
    const plan = view?.plan;
    if (!plan) return;
    expect(plan.purchases.some((p) => p.materialId === 'steel')).toBe(true);
    expect(plan.cash.peakNeed).toBeGreaterThan(0);
    expect(plan.cash.receivableDay).toBeGreaterThan(Math.max(...plan.purchases.map((p) => p.balanceDueDay)));
    expect(plan.delivery.promisedDay).toBeGreaterThanOrEqual(plan.requestedDay);
  });

  it('gives different CFO and COO recommendations', () => {
    const s = engine.state();
    const id = report.pendingDecisions[0]?.id ?? '';
    const cfo = selectAdvisorBrief(s, 'cfo', id);
    const coo = selectAdvisorBrief(s, 'coo', id);
    expect(cfo?.recommendedOptionId).toBeDefined();
    expect(cfo?.recommendedOptionId).not.toBe(coo?.recommendedOptionId);
    expect(cfo?.citations.length).toBeGreaterThan(0);
  });
});

describe('clock, ledger, projection, replay', () => {
  it('advances one day with caused, workspace-stamped events', () => {
    const e = newEngine();
    const before = e.ledger().length;
    const events = e.advance(1);
    expect(e.state().day).toBe(2);
    expect(e.ledger().length).toBe(before + events.length);
    for (const ev of e.ledger()) {
      expect(ev.cause).toBeDefined();
      expect(ev.workspaceId).toBe('ws_test');
      expect(ev.code.startsWith('ledger.')).toBe(true);
    }
  });

  it('project() leaves the live state untouched', () => {
    const e = newEngine();
    const h = stateHash(e.state());
    const p = e.project([{ type: 'approveOption', decisionId: 'dec-0001', optionId: 'negotiate' }], 30);
    expect(p.ok).toBe(true);
    expect(stateHash(e.state())).toBe(h);
  });

  it('negotiate looks fine at +7 and costs cash by +30 (delayed hit from payment terms)', () => {
    const view = selectDecision(newEngine().state(), 'dec-0001');
    const neg = view?.impacts?.options.find((o) => o.optionId === 'negotiate');
    const d7 = neg?.horizons.find((h) => h.horizonDays === 7);
    const d30 = neg?.horizons.find((h) => h.horizonDays === 30);
    expect(d7?.delta.cash).toBeGreaterThanOrEqual(0);
    expect(d7?.delta.grossMarginBps).toBeGreaterThan(0);
    expect(d30?.delta.cash).toBeLessThan(-tl(10_000_000));
  });

  it('replays a save game to the same state', () => {
    const e = newEngine();
    e.dispatch({ type: 'approveOption', decisionId: 'dec-0001', optionId: 'switch' });
    e.advance(7);
    e.advance(3);
    const r = fromSnapshot(seed(), e.snapshot());
    expect(r.ok).toBe(true);
    if (r.ok) expect(stateHash(r.engine.state())).toBe(stateHash(e.state()));
  });

  it('each steel option leads to a different Day-31 state', () => {
    const hashes = ['absorb', 'negotiate', 'switch', 'passOn'].map((optionId) => {
      const e = newEngine();
      expect(e.dispatch({ type: 'approveOption', decisionId: 'dec-0001', optionId }).ok).toBe(true);
      e.advance(30);
      expect(e.state().day).toBe(31);
      return stateHash({ ...e.state(), decisions: [], nextSeq: 0 });
    });
    expect(new Set(hashes).size).toBe(4);
  });

  it('acknowledges an informational telegram but not one with an open decision', () => {
    const e = newEngine();
    const [order, steel] = selectMorningReport(e.state()).developments;
    expect(e.dispatch({ type: 'acknowledgeDevelopment', developmentId: steel?.id ?? '' }).ok).toBe(false);
    expect(e.dispatch({ type: 'acknowledgeDevelopment', developmentId: order?.id ?? '' }).ok).toBe(true);
    expect(selectMorningReport(e.state()).developments.map((d) => d.id)).toEqual([steel?.id]);
  });

  it('rejects invalid commands without changing state', () => {
    const e = newEngine();
    const h = stateHash(e.state());
    const r = e.dispatch({ type: 'approveOption', decisionId: 'dec-0001', optionId: 'nope' });
    expect(r.ok).toBe(false);
    expect(stateHash(e.state())).toBe(h);
  });
});

describe('engine purity', () => {
  it('has no Math.random, Date, I/O or UI imports in engine source', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p);
      }
    };
    walk(join(import.meta.dirname, '.'));
    const banned = [/Math\.random/, /\bnew Date\b/, /\bDate\.now\b/, /from ['"]node:/, /from ['"](fs|react|react-dom)['"]/, /\bfetch\(/, /\bperformance\./];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const b of banned) expect(`${f}: ${b.test(src) ? b.source : 'ok'}`).toBe(`${f}: ok`);
    }
  });
});
