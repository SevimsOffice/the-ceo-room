/**
 * selectDecisionSummary: the dossier the Desk re-reads after every state change. It must not run a
 * forward projection (no option impacts, no runway), so the projection module is armed to throw.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STEEL_DECISION, engineAt } from '../test/seedFixture';
import { selectDecision, selectDecisionSummary } from './index';

const guard = vi.hoisted(() => ({ forbid: false }));

vi.mock('./projection/project', async (importOriginal) => {
  const real = await importOriginal<typeof import('./projection/project')>();
  return {
    ...real,
    projectState: (...args: Parameters<typeof real.projectState>) => {
      if (guard.forbid) throw new Error('projectState called');
      return real.projectState(...args);
    },
    projectedRunway: (...args: Parameters<typeof real.projectedRunway>) => {
      if (guard.forbid) throw new Error('projectedRunway called');
      return real.projectedRunway(...args);
    },
  };
});

vi.mock('./projection/impact', async (importOriginal) => {
  const real = await importOriginal<typeof import('./projection/impact')>();
  return {
    ...real,
    decisionImpacts: (...args: Parameters<typeof real.decisionImpacts>) => {
      if (guard.forbid) throw new Error('decisionImpacts called');
      return real.decisionImpacts(...args);
    },
  };
});

afterEach(() => {
  guard.forbid = false;
});

describe('selectDecisionSummary', () => {
  it('runs no projection and no impact calculation', () => {
    const s = engineAt().state();
    guard.forbid = true;
    const v = selectDecisionSummary(s, STEEL_DECISION);
    expect(v?.decision.id).toBe(STEEL_DECISION);
    // the guard really is armed: the full Decision Room view does project
    expect(() => selectDecision(s, STEEL_DECISION)).toThrow(/called/);
  });

  it('carries the situation, options and the supporting figures of selectDecision except the runway', () => {
    const s = engineAt().state();
    const full = selectDecision(s, STEEL_DECISION)!;
    const sum = selectDecisionSummary(s, STEEL_DECISION)!;
    expect(sum.situation).toEqual(full.situation);
    expect(sum.decision).toBe(full.decision);
    expect(sum.decision.options.length).toBeGreaterThan(1);
    expect(sum.supportingFigures).toEqual(full.supportingFigures.filter((f) => f.code !== 'figure.runwayDays'));
    expect(full.supportingFigures.map((f) => f.code).slice(0, 2)).toEqual(['figure.cash', 'figure.runwayDays']);
  });

  it('returns null for an unknown decision', () => {
    expect(selectDecisionSummary(engineAt().state(), 'dec-9999')).toBeNull();
  });
});
