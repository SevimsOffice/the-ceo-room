import { describe, expect, it } from 'vitest';
import { createEngine, selectMorningReport } from '@ceo-room/engine';
import { SeedDataSource, loadSeed, rawSeed } from './index';

describe('SeedDataSource', () => {
  it('loads and validates the bundled seed', async () => {
    const seed = await new SeedDataSource().load('ws_test');
    expect(seed.company.company.simulated).toBe(true);
    expect(seed.departments).toHaveLength(6);
    expect(seed.customers).toHaveLength(8);
    expect(seed.suppliers).toHaveLength(6);
    expect(seed.productFamilies).toHaveLength(4);
    expect(seed.eventCards.length).toBeGreaterThanOrEqual(6);
  });

  it('feeds the engine with the requested workspace stamped on records', async () => {
    const seed = await new SeedDataSource().load('ws_test');
    const s = createEngine(seed, { rngSeed: 42, workspaceId: 'ws_test' }).state();
    expect(s.orders.every((o) => o.workspaceId === 'ws_test')).toBe(true);
    expect(selectMorningReport(s).day).toBe(1);
  });

  it('returns a fresh copy each load', () => {
    expect(loadSeed()).not.toBe(loadSeed());
    expect(rawSeed).toBeTypeOf('object');
  });
});
