import type { CompanyState } from '@ceo-room/engine';
import type { Directory } from '@ceo-room/i18n';

/** Names of the company's records for i18n params that carry an id (customers, suppliers, …). */
export function buildDirectory(s: Readonly<CompanyState>): Directory {
  return {
    customers: Object.fromEntries(s.customers.map((c) => [c.id, c.name])),
    suppliers: Object.fromEntries(s.suppliers.map((c) => [c.id, c.name])),
    plants: Object.fromEntries(s.plants.map((p) => [p.id, p.name])),
    materials: Object.fromEntries(s.materials.map((m) => [m.id, m.nameKey])),
    families: Object.fromEntries(s.productFamilies.map((f) => [f.id, f.nameKey])),
    lines: Object.fromEntries(s.lines.map((l) => [l.id, { kindKey: l.kindKey, plantId: l.plantId }])),
  };
}
