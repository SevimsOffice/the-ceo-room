import type { Company, CompanyState, WorkspaceId } from '../model/types';
import { isoWeekdayIndex } from '../model/calendarDate';
import { money } from '../model/units';
import { initRng } from '../rng/rng';
import { Tx, cloneState, rule } from '../events/tx';
import type { GameEvent } from '../events/types';
import { recostOpenOrders } from '../systems/procurement';
import { openDay } from '../systems/tick';
import type { SeedBundle, SeedCompany } from './types';

export interface EngineOptions {
  rngSeed: number;
  workspaceId: WorkspaceId;
}

const nextNumber = (ids: string[]): number =>
  ids.reduce((m, id) => Math.max(m, Number(/(\d+)$/.exec(id)?.[1] ?? 0)), 0) + 1;

function stamp<T extends { workspaceId: WorkspaceId }>(rows: T[], ws: WorkspaceId): T[] {
  return rows.map((r) => ({ ...r, workspaceId: ws }));
}

/** Company record with the defaults the seed may omit; Day 1's weekday from the snapshot date. */
function companyFromSeed(c: SeedCompany, ws: WorkspaceId): Company {
  const snapshotDate = c.snapshotDate ?? null;
  return {
    ...c,
    workspaceId: ws,
    source: c.source ?? 'seed',
    snapshotDate,
    day1Weekday: snapshotDate === null ? 0 : isoWeekdayIndex(snapshotDate),
  };
}

/** Opening state built from the seed (Day 1, before the morning's events). */
export function stateFromSeed(seedIn: SeedBundle, opts: EngineOptions): CompanyState {
  const seed = cloneState(seedIn);
  const ws = opts.workspaceId;
  const f = seed.finance;
  return {
    workspaceId: ws,
    seedVersion: seed.company.company.seedVersion,
    rngSeed: opts.rngSeed >>> 0,
    day: 1,
    nextSeq: 1,
    nextCommandSeq: 1,
    counters: {
      order: nextNumber(seed.orders.salesOrders.map((o) => o.id)),
      po: nextNumber(seed.orders.purchaseOrders.map((o) => o.id)),
      receivable: nextNumber(f.receivables.map((r) => r.id)),
      payable: nextNumber(f.payables.map((p) => p.id)),
      development: 1,
      decision: 1,
    },
    settings: seed.company.settings,
    company: companyFromSeed(seed.company.company, ws),
    departments: stamp(seed.departments, ws),
    workforce: stamp(seed.workforce, ws),
    plants: stamp(seed.plants.plants, ws),
    lines: stamp(seed.plants.lines, ws),
    productFamilies: stamp(seed.productFamilies, ws),
    materials: stamp(seed.materials, ws),
    suppliers: stamp(seed.suppliers, ws),
    customers: stamp(seed.customers, ws),
    orders: stamp(seed.orders.salesOrders, ws).map((o) => ({ ...o, listUnitPrice: o.listUnitPrice ?? o.unitPrice })),
    purchaseOrders: stamp(seed.orders.purchaseOrders, ws),
    receivables: stamp(f.receivables, ws),
    payables: stamp(f.payables, ws),
    recurringCosts: stamp(f.recurringCosts, ws),
    openingCash: f.cash,
    cash: f.cash,
    accruals: { overtime: money(0), energy: money(0) },
    dayAcc: { revenue: money(0), cogs: money(0), overtimePersonHours: 0, productionMinutes: 0 },
    periods: stamp(f.history, ws),
    daily: [],
    eventCards: stamp(seed.eventCards, ws),
    firedCards: [],
    developments: [],
    decisions: [],
    rng: initRng(opts.rngSeed),
  };
}

/** Opening state + Day-1 morning (cards, intake). */
export function bootstrap(seed: SeedBundle, opts: EngineOptions): { state: CompanyState; events: GameEvent[] } {
  const tx = new Tx(stateFromSeed(seed, opts));
  tx.emit('SeedLoaded', { seedVersion: tx.s.seedVersion }, rule('engine.init'), { seedVersion: tx.s.seedVersion });
  recostOpenOrders(tx, rule('engine.init'));
  openDay(tx, 1);
  return { state: tx.s, events: tx.events };
}
