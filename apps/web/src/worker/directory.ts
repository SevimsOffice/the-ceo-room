import type { CompanyState } from '@ceo-room/engine';
import type { Directory } from '@ceo-room/i18n';

/**
 * Names of the company's records for i18n params that carry an id (customers, suppliers, …).
 * Imported records carry plain labels (`name`, `kindName`) that win over their generic i18n keys
 * (the translator prints a value that is not a catalogue key as it is).
 */
export function buildDirectory(s: Readonly<CompanyState>): Directory {
  return {
    customers: Object.fromEntries(s.customers.map((c) => [c.id, c.name])),
    suppliers: Object.fromEntries(s.suppliers.map((c) => [c.id, c.name])),
    plants: Object.fromEntries(s.plants.map((p) => [p.id, p.name])),
    materials: Object.fromEntries(s.materials.map((m) => [m.id, m.name ?? m.nameKey])),
    families: Object.fromEntries(s.productFamilies.map((f) => [f.id, f.name ?? f.nameKey])),
    lines: Object.fromEntries(s.lines.map((l) => [l.id, { kindKey: l.kindName ?? l.kindKey, plantId: l.plantId }])),
  };
}
