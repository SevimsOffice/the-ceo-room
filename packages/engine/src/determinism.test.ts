/**
 * Determinism (SIMULATION_DESIGN §2, §8): same seed + same commands = byte-identical state;
 * a save game (seed version + rngSeed + command log) replays to the live state.
 */
import { describe, expect, it } from 'vitest';
import { RNG_SEED, STEEL_DECISION, WS, newEngine, seed } from '../test/seedFixture';
import { checkInvariants } from '../test/invariants';
import { type CompanyState, type Engine, type SaveGame, STREAMS, fromSnapshot, initRng, selectMorningReport, stateHash, streamSeed } from './index';

/** Fixed CEO script: decide steel on Day 1, analyse then grant the discount, reach Day 31. */
function script(e: Engine): void {
  const ok = (r: { ok: boolean }): void => {
    if (!r.ok) throw new Error('script command rejected');
  };
  ok(e.dispatch({ type: 'acknowledgeDevelopment', developmentId: 'dev-0001' }));
  ok(e.dispatch({ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'negotiate' }));
  e.advance(8); // Day 9: discount demand arrives
  ok(e.dispatch({ type: 'requestAnalysis', decisionId: 'dec-0002' }));
  e.advance(1);
  ok(e.dispatch({ type: 'approveOption', decisionId: 'dec-0002', optionId: 'grant' }));
  e.advance(21);
}

/**
 * Golden hash of the scripted Day-31 state (rngSeed 42, seed v1). If an intentional engine or seed
 * change moves it, update it in the same commit and say why; an unexplained change is a bug.
 */
// Review fixes 1 (Decision.basis) and 5 (Order.listUnitPrice) added state fields; outcomes unchanged.
// M4a: Company gained source / snapshotDate / day1Weekday (data import); without them the state is
// byte-identical to the M3 golden state (checked below), so outcomes are unchanged.
const GOLDEN_DAY31 = 'e8c2c497';
const GOLDEN_DAY31_M3 = 'c1d8ee49';

describe('same seed + same commands → identical state', () => {
  const a = newEngine();
  const b = newEngine(); // separately loaded and validated seed
  script(a);
  script(b);

  it('reaches Day 31 with byte-identical state and ledger', () => {
    expect(a.state().day).toBe(31);
    expect(stateHash(a.state())).toBe(stateHash(b.state()));
    expect(JSON.stringify(a.state())).toBe(JSON.stringify(b.state()));
    expect(JSON.stringify(a.ledger())).toBe(JSON.stringify(b.ledger()));
  });

  it('matches the golden Day-31 hash', () => {
    expect(stateHash(a.state())).toBe(GOLDEN_DAY31);
  });

  it('differs from the M3 golden state only by the M4a company metadata', () => {
    const { source, snapshotDate, day1Weekday, ...company } = a.state().company;
    expect({ source, snapshotDate, day1Weekday }).toEqual({ source: 'seed', snapshotDate: null, day1Weekday: 0 });
    expect(stateHash({ ...a.state(), company } as unknown as CompanyState)).toBe(GOLDEN_DAY31_M3);
  });

  it('a save game replays to the live state (hash, state and ledger)', () => {
    const save = a.snapshot();
    expect(save).toMatchObject({ format: 1, rngSeed: RNG_SEED, workspaceId: WS, seedVersion: a.state().seedVersion });
    const r = fromSnapshot(seed(), JSON.parse(JSON.stringify(save)) as SaveGame);
    if (!r.ok) throw new Error(r.error.code);
    expect(stateHash(r.engine.state())).toBe(stateHash(a.state()));
    expect(JSON.stringify(r.engine.state())).toBe(JSON.stringify(a.state()));
    expect(JSON.stringify(r.engine.ledger())).toBe(JSON.stringify(a.ledger()));
    expect(r.engine.snapshot()).toEqual(save);
  });

  it('a replayed engine keeps running in lockstep with the original', () => {
    const r = fromSnapshot(seed(), a.snapshot());
    if (!r.ok) throw new Error(r.error.code);
    const live = newEngine();
    script(live);
    live.advance(15);
    r.engine.advance(15);
    expect(stateHash(r.engine.state())).toBe(stateHash(live.state()));
  });

  it('rejects a save game for another format or seed version, and a log that no longer replays', () => {
    const save = a.snapshot();
    const fmt = fromSnapshot(seed(), { ...save, format: 2 as 1 });
    expect(fmt.ok ? null : fmt.error.code).toBe('error.saveFormat');
    const ver = fromSnapshot(seed(), { ...save, seedVersion: save.seedVersion + 1 });
    expect(ver.ok ? null : ver.error.code).toBe('error.seedVersionMismatch');
    const bad: SaveGame = { ...save, log: [...save.log, { kind: 'dispatch', command: { type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'switch' } }] };
    const rep = fromSnapshot(seed(), bad);
    expect(rep.ok ? null : rep.error.code).toBe('error.replayFailed');
  });
});

describe('time and replay granularity', () => {
  it('advance(30) = 30 × advance(1) = advance(7) + advance(23)', () => {
    const one = newEngine();
    one.advance(30);
    const daily = newEngine();
    for (let i = 0; i < 30; i++) daily.advance(1);
    const split = newEngine();
    split.advance(7);
    split.advance(23);
    expect(stateHash(daily.state())).toBe(stateHash(one.state()));
    expect(stateHash(split.state())).toBe(stateHash(one.state()));
    expect(JSON.stringify(daily.ledger())).toBe(JSON.stringify(one.ledger()));
  });

  it('advance(0) and negative/fractional advances do nothing or floor', () => {
    const e = newEngine();
    const h = stateHash(e.state());
    expect(e.advance(0)).toEqual([]);
    expect(e.advance(-3)).toEqual([]);
    expect(stateHash(e.state())).toBe(h);
    expect(e.snapshot().log).toEqual([]);
    e.advance(2.9);
    expect(e.state().day).toBe(3);
  });
});

describe('other rngSeeds', () => {
  it.each([7, 2026, 0xdeadbeef])('rngSeed %i loads, tells the same Day-1 story and runs 60 days cleanly', (rngSeed) => {
    const e = newEngine(rngSeed);
    const r = selectMorningReport(e.state());
    expect(r.developments.map((d) => d.cardId)).toEqual(['card_large_order', 'card_steel_price']);
    expect(r.pendingDecisions.map((d) => d.id)).toEqual([STEEL_DECISION]);
    expect(e.dispatch({ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'switch' }).ok).toBe(true);
    e.advance(60);
    expect(e.state().day).toBe(61);
    expect(checkInvariants(e.state(), e.ledger(), WS)).toEqual([]);
    // and it is itself deterministic
    const twin = newEngine(rngSeed);
    twin.dispatch({ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'switch' });
    twin.advance(60);
    expect(stateHash(twin.state())).toBe(stateHash(e.state()));
  });

  it('a different rngSeed changes the simulated outcome, not just the RNG state', () => {
    const strip = (e: Engine): string => JSON.stringify({ ...e.state(), rng: null, rngSeed: null });
    const a = newEngine(RNG_SEED);
    const b = newEngine(7);
    a.advance(60);
    b.advance(60);
    expect(strip(a)).not.toBe(strip(b));
  });

  it('named RNG streams are derived independently from (rngSeed, stream name)', () => {
    const rng = initRng(RNG_SEED);
    expect(Object.keys(rng)).toEqual([...STREAMS]);
    for (const s of STREAMS) expect(rng[s]).toBe(streamSeed(RNG_SEED, s));
    expect(new Set(Object.values(rng)).size).toBe(STREAMS.length);
    // adding a stream would not shift the existing ones: each depends only on its own name
    expect(streamSeed(RNG_SEED, 'events')).toBe(initRng(RNG_SEED).events);
    expect(streamSeed(RNG_SEED, 'someFutureStream')).not.toBe(rng.events);
  });
});
