/**
 * Acceptance test (M4a): the sample company NOVARA exported to the template, validated and imported
 * with NOVARA_PROFILE runs exactly like the seed: same bundle, same Day-1 state (after normalising
 * the import's company metadata), same Desk read models and advisor briefs, and the same state after
 * 30 days of the same commands. For both the Turkish and the English template.
 */
import { describe, expect, it } from 'vitest';
import {
  type CompanyState,
  type Engine,
  type SeedBundle,
  createEngine,
  selectAdvisorBrief,
  selectCalendarDay,
  selectDecision,
  selectMorningReport,
  selectOrderBook,
  selectOverallHealth,
  selectProjectedRunway,
  selectWorkforce,
  stateHash,
} from '@ceo-room/engine';
import { loadSeed } from '@ceo-room/seed-data';
import { NOVARA_PROFILE, SAMPLE_SNAPSHOT_DATE, exportTemplate, toSeedBundle, validateWorkbook } from './index';

const seed = loadSeed();
const OPTS = { rngSeed: 42, workspaceId: 'ws_test' };

/** The seed's company record stands in for the imported one (source / snapshot date / day-1 weekday). */
function normalised(s: CompanyState, ref: CompanyState): CompanyState {
  return { ...s, company: ref.company };
}

function deskOf(s: CompanyState): unknown {
  const { company: _c, date: _d, forecast: _f, ...report } = selectMorningReport(s);
  const runway = selectProjectedRunway(s);
  return {
    report,
    runway,
    health: selectOverallHealth(s, runway),
    workforce: selectWorkforce(s),
    orderBook: selectOrderBook(s),
    decisions: s.decisions.map((d) => selectDecision(s, d.id)),
    briefs: s.decisions.filter((d) => d.status === 'open').map((d) => [selectAdvisorBrief(s, 'cfo', d.id), selectAdvisorBrief(s, 'coo', d.id)]),
  };
}

/** The determinism suite's CEO script: decide steel on Day 1, analyse then grant the discount, reach Day 31. */
function script(e: Engine): void {
  const ok = (r: { ok: boolean }): void => {
    if (!r.ok) throw new Error('script command rejected');
  };
  ok(e.dispatch({ type: 'acknowledgeDevelopment', developmentId: 'dev-0001' }));
  ok(e.dispatch({ type: 'approveOption', decisionId: 'dec-0001', optionId: 'negotiate' }));
  e.advance(8);
  ok(e.dispatch({ type: 'requestAnalysis', decisionId: 'dec-0002' }));
  e.advance(1);
  ok(e.dispatch({ type: 'approveOption', decisionId: 'dec-0002', optionId: 'grant' }));
  e.advance(21);
}

describe.each(['tr', 'en'] as const)('NOVARA round trip through the %s template', (lang) => {
  const wb = exportTemplate(seed, { lang, example: true });
  const report = validateWorkbook(wb);
  const result = toSeedBundle(wb, { workspaceId: seed.finance.workspaceId, profile: NOVARA_PROFILE });
  const bundle = (): SeedBundle => {
    if (!result.ok) throw new Error(JSON.stringify(result.report.issues.filter((i) => i.severity === 'error')));
    return result.bundle;
  };

  it('validates with zero errors (warnings only for overdue items and invoices dated after Day 1)', () => {
    expect(report.summary.errors).toBe(0);
    expect(report.templateVersion).toBe(1);
    expect(report.snapshotDate).toBe(SAMPLE_SNAPSHOT_DATE);
    expect(new Set(report.issues.filter((i) => i.severity === 'warning').map((i) => i.code))).toEqual(
      new Set(['import.date.overdue', 'import.date.invoiceAfterSnapshot']),
    );
    // every column is filled in the example, so no defaults are applied
    expect(report.summary.info).toBe(0);
    expect(report.summary.rows).toMatchObject({ Customers: 8, OpenOrders: 14, Receivables: 44, Payables: 18, History: 2 });
  });

  it('rebuilds the seed bundle byte for byte, apart from source and snapshot date', () => {
    const b = bundle();
    expect(b.company.company).toMatchObject({ source: 'import', snapshotDate: SAMPLE_SNAPSHOT_DATE, simulated: true });
    const { source: _s, snapshotDate: _d, ...company } = b.company.company;
    expect(JSON.stringify({ ...b, company: { ...b.company, company } })).toBe(JSON.stringify(seed));
  });

  it('Day 1 is identical to the seed engine: state, ledger, Desk, decisions and both advisor briefs', () => {
    const imp = createEngine(bundle(), OPTS);
    const sim = createEngine(seed, OPTS);
    expect(stateHash(normalised(imp.state(), sim.state()))).toBe(stateHash(sim.state()));
    expect(JSON.stringify(imp.ledger())).toBe(JSON.stringify(sim.ledger()));
    expect(deskOf(imp.state())).toEqual(deskOf(sim.state()));
    expect(imp.state().decisions.length).toBeGreaterThan(0);
    expect(selectCalendarDay(imp.state())).toMatchObject({ date: SAMPLE_SNAPSHOT_DATE, weekdayCode: 'weekday.mon', forecast: false });
  });

  it('stays identical after 30 days of the same commands (determinism carries over)', () => {
    const imp = createEngine(bundle(), OPTS);
    const sim = createEngine(seed, OPTS);
    script(imp);
    script(sim);
    expect(imp.state().day).toBe(31);
    expect(stateHash(normalised(imp.state(), sim.state()))).toBe(stateHash(sim.state()));
    expect(JSON.stringify(imp.ledger())).toBe(JSON.stringify(sim.ledger()));
    expect(deskOf(imp.state())).toEqual(deskOf(sim.state()));
    expect(selectCalendarDay(imp.state())).toMatchObject({ date: '2027-02-03', forecast: true });
  });
});

describe('the template languages differ only in labels', () => {
  it('tr and en workbooks carry the same keys and data, different label and unit rows', () => {
    const tr = exportTemplate(seed, { lang: 'tr', example: true });
    const en = exportTemplate(seed, { lang: 'en', example: true });
    for (const name of Object.keys(en).filter((n) => n !== 'README')) {
      expect(tr[name]![0]).toEqual(en[name]![0]);
      expect(tr[name]![1]).not.toEqual(en[name]![1]);
    }
    const a = toSeedBundle(tr, { workspaceId: 'w', profile: NOVARA_PROFILE });
    const b = toSeedBundle(en, { workspaceId: 'w', profile: NOVARA_PROFILE });
    expect(a.ok && b.ok && JSON.stringify(a.bundle) === JSON.stringify(b.bundle)).toBe(true);
  });
});
