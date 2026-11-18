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
import { type Engine, type SeedBundle, createEngine, validateSeedBundle } from '../src/index';

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
