import {
  type CompanyDataSource,
  type SeedBundle,
  type WorkspaceId,
  validateSeedBundle,
} from '@ceo-room/engine';
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

/** The static seed files, untyped as they come from disk (bundled at build time, no runtime I/O). */
export const rawSeed: unknown = {
  company,
  departments,
  plants,
  productFamilies,
  materials,
  suppliers,
  customers,
  orders,
  workforce,
  finance,
  eventCards,
};

export class SeedValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(`invalid seed:\n${errors.join('\n')}`);
  }
}

/** Validate the bundled seed; throws SeedValidationError with every problem found. */
export function loadSeed(): SeedBundle {
  const v = validateSeedBundle(JSON.parse(JSON.stringify(rawSeed)));
  if (!v.ok) throw new SeedValidationError(v.errors);
  return v.bundle;
}

/**
 * V1 data source (ADR-0006): the pre-loaded simulated company NOVARA.
 * The seed is a template; `createEngine(seed, { workspaceId })` stamps the workspace on every record.
 */
export class SeedDataSource implements CompanyDataSource {
  async load(_workspaceId: WorkspaceId): Promise<SeedBundle> {
    return loadSeed();
  }
}
