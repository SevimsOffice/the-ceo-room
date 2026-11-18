/** Test-only: the committed seed files, validated. The engine itself never imports these. */
import company from '../../../data/seed/company.json' with { type: 'json' };
import departments from '../../../data/seed/departments.json' with { type: 'json' };
import plants from '../../../data/seed/plants.json' with { type: 'json' };
import productFamilies from '../../../data/seed/productFamilies.json' with { type: 'json' };
import materials from '../../../data/seed/materials.json' with { type: 'json' };
import suppliers from '../../../data/seed/suppliers.json' with { type: 'json' };
import customers from '../../../data/seed/customers.json' with { type: 'json' };
import orders from '../../../data/seed/orders.json' with { type: 'json' };
import workforce from '../../../data/seed/workforce.json' with { type: 'json' };
import finance from '../../../data/seed/finance.json' with { type: 'json' };
import eventCards from '../../../data/seed/eventCards.json' with { type: 'json' };
import { type CompanyState, type Engine, type SeedBundle, createEngine, validateSeedBundle } from '../src/index';

export function rawSeed(): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify({ company, departments, plants, productFamilies, materials, suppliers, customers, orders, workforce, finance, eventCards }),
  ) as Record<string, unknown>;
}

export function seed(): SeedBundle {
  const v = validateSeedBundle(rawSeed());
  if (!v.ok) throw new Error(v.errors.join('\n'));
  return v.bundle;
}

export const RNG_SEED = 42;
export const WS = 'ws_test';

export function newEngine(rngSeed = RNG_SEED): Engine {
  return createEngine(seed(), { rngSeed, workspaceId: WS });
}

// ---------------------------------------------------------------------------------------------
// Shared, memoised fixtures for the Milestone 1 suite (per test file; vitest isolates modules).

let seedMemo: SeedBundle | null = null;

/** The validated committed seed, built once. `createEngine` clones it, so sharing is safe. */
export function sharedSeed(): SeedBundle {
  seedMemo ??= seed();
  return seedMemo;
}

/** Engine on the shared seed (cheaper than `newEngine` when a file builds many engines). */
export function engineAt(rngSeed = RNG_SEED, bundle: SeedBundle = sharedSeed()): Engine {
  return createEngine(bundle, { rngSeed, workspaceId: WS });
}

export function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
  }
  return x;
}

let day1Memo: Readonly<CompanyState> | null = null;

/**
 * Day-1 morning state for rngSeed 42, deep-frozen. Read-only: selectors and projections memoise per
 * state object, so sharing it keeps the suite fast; freezing proves they never mutate it (ESM is
 * strict mode, so any write throws).
 */
export function day1State(): Readonly<CompanyState> {
  day1Memo ??= deepFreeze(engineAt().state());
  return day1Memo;
}

/** Seed with some event cards removed (counterfactual runs for propagation tests). */
export function seedWithout(...cardIds: string[]): SeedBundle {
  const s = seed();
  s.eventCards = s.eventCards.filter((c) => !cardIds.includes(c.id));
  return s;
}

/** The Day-1 steel decision and its four options (spec: A negotiate, B switch, C pass on; absorb = baseline). */
export const STEEL_DECISION = 'dec-0001';
export const STEEL_OPTIONS = ['absorb', 'negotiate', 'switch', 'passOn'] as const;
