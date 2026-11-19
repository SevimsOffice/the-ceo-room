/**
 * The custom decision memo: lines typed by the CEO, turned into the engine's allow-listed intent
 * commands (placePurchaseOrder, switchSupplier, repriceOrders, grantDiscount). Inputs are checked
 * against the engine's limits (COMMAND_LIMITS, posted in the room's MemoCatalog) before a preview;
 * the engine checks every memo again on preview and on sealing.
 */
import type { CeoCommand } from '@ceo-room/engine';
import type { MemoCatalog } from '../worker/protocol';

export type MemoKind = CeoCommand['type'];
export const MEMO_KINDS: readonly MemoKind[] = ['placePurchaseOrder', 'switchSupplier', 'repriceOrders', 'grantDiscount'];
/** Lines a memo may hold. */
export const MEMO_MAX_LINES = 4;

/** One typed line of the memo; numbers stay as typed until checked. */
export type MemoLine =
  | { kind: 'placePurchaseOrder'; supplierId: string; materialId: string; qty: string }
  | { kind: 'switchSupplier'; materialId: string; toSupplierId: string }
  | { kind: 'repriceOrders'; materialId: string; percent: string }
  | { kind: 'grantDiscount'; customerId: string; percent: string };

/** A problem with a line: an i18n key (ui.room.memo.error.*) and its params. */
export interface LineError {
  key: string;
  params: Record<string, string | number>;
}

export type LineResult = { ok: true; command: CeoCommand } | { ok: false; error: LineError };

/** Which kinds this decision's memo may use (repriceOrders only on a supplier price rise). */
export function availableKinds(c: MemoCatalog): MemoKind[] {
  return MEMO_KINDS.filter((k) => k !== 'repriceOrders' || c.repriceMaterialId !== null);
}

/** Suppliers that may replace the preferred one for a material (they offer it and are not it). */
export function switchTargets(c: MemoCatalog, materialId: string): string[] {
  const preferred = c.materials.find((m) => m.id === materialId)?.preferredSupplierId;
  return c.offers.filter((o) => o.materialId === materialId && o.supplierId !== preferred).map((o) => o.supplierId);
}

/** Materials a supplier offers. */
export function offeredMaterials(c: MemoCatalog, supplierId: string): string[] {
  return c.offers.filter((o) => o.supplierId === supplierId).map((o) => o.materialId);
}

/** Suppliers with at least one offer, in catalogue order. */
export function offeringSuppliers(c: MemoCatalog): string[] {
  return [...new Set(c.offers.map((o) => o.supplierId))];
}

/** A fresh line of a kind, filled with the decision's own subject where there is one. */
export function newLine(kind: MemoKind, c: MemoCatalog): MemoLine {
  switch (kind) {
    case 'placePurchaseOrder': {
      const material = c.repriceMaterialId ?? c.offers[0]?.materialId ?? '';
      const supplier = c.materials.find((m) => m.id === material)?.preferredSupplierId ?? c.offers[0]?.supplierId ?? '';
      return { kind, supplierId: supplier, materialId: material, qty: '' };
    }
    case 'switchSupplier': {
      const material = c.repriceMaterialId ?? c.materials.find((m) => switchTargets(c, m.id).length > 0)?.id ?? '';
      return { kind, materialId: material, toSupplierId: switchTargets(c, material)[0] ?? '' };
    }
    case 'repriceOrders':
      return { kind, materialId: c.repriceMaterialId ?? '', percent: '' };
    case 'grantDiscount': {
      const d = c.demand;
      return { kind, customerId: d?.customerId ?? c.customers[0]?.id ?? '', percent: d ? bpsToPercentText(d.discountBps) : '' };
    }
  }
}

/** 1250 bps → "12.5" (typed form; parsePercent reads it back). */
export function bpsToPercentText(bps: number): string {
  return String(bps / 100);
}

/**
 * A typed percentage → basis points: "12", "12,5", "12.5", "0.25" (at most two decimals). Null when
 * it is not such a number.
 */
export function parsePercent(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** A typed whole quantity: digits, optional thousands separators ("2.000", "2,000", "2 000"). */
export function parseQty(text: string): number | null {
  const s = text.trim().replace(/[.,\s]/g, '');
  if (!/^\d{1,12}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

const err = (key: string, params: Record<string, string | number> = {}): LineResult => ({ ok: false, error: { key: `ui.room.memo.error.${key}`, params } });

/** Check one line against the catalogue and the engine's limits and build its command. */
export function lineToCommand(line: MemoLine, c: MemoCatalog): LineResult {
  switch (line.kind) {
    case 'placePurchaseOrder': {
      if (!c.offers.some((o) => o.supplierId === line.supplierId && o.materialId === line.materialId)) return err('noOffer');
      const qty = parseQty(line.qty);
      if (qty === null) return err('qty', { max: c.limits.maxPurchaseQty });
      if (qty < 1 || qty > c.limits.maxPurchaseQty) return err('qty', { max: c.limits.maxPurchaseQty });
      return { ok: true, command: { type: 'placePurchaseOrder', supplierId: line.supplierId, materialId: line.materialId, qty } };
    }
    case 'switchSupplier':
      if (!switchTargets(c, line.materialId).includes(line.toSupplierId)) return err('noSwitch');
      return { ok: true, command: { type: 'switchSupplier', materialId: line.materialId, toSupplierId: line.toSupplierId } };
    case 'repriceOrders': {
      if (c.repriceMaterialId === null || line.materialId !== c.repriceMaterialId) return err('noReprice');
      const bps = parsePercent(line.percent);
      if (bps === null || bps < 0 || bps > c.limits.maxPassThroughBps) return err('passThrough', { max: c.limits.maxPassThroughBps });
      return { ok: true, command: { type: 'repriceOrders', materialId: line.materialId, passThroughBps: bps } };
    }
    case 'grantDiscount': {
      if (!c.customers.some((x) => x.id === line.customerId)) return err('noCustomer');
      const bps = parsePercent(line.percent);
      if (bps === null || bps < 0 || bps > c.limits.maxDiscountBps) return err('discount', { max: c.limits.maxDiscountBps });
      return { ok: true, command: { type: 'grantDiscount', customerId: line.customerId, discountBps: bps } };
    }
  }
}

/** The whole memo: its commands when every line is valid, else the first error per line. */
export function memoCommands(lines: readonly MemoLine[], c: MemoCatalog): { commands: CeoCommand[] | null; errors: (LineError | null)[] } {
  const results = lines.map((l) => lineToCommand(l, c));
  const errors = results.map((r) => (r.ok ? null : r.error));
  const ok = lines.length > 0 && lines.length <= MEMO_MAX_LINES && results.every((r) => r.ok);
  return { commands: ok ? results.map((r) => (r as { ok: true; command: CeoCommand }).command) : null, errors };
}

/** True when the memo answers a discount demand (grants the demanding customer a discount). */
export function answersDemand(commands: readonly CeoCommand[], c: MemoCatalog): boolean {
  const d = c.demand;
  return d === null || commands.some((x) => x.type === 'grantDiscount' && x.customerId === d.customerId);
}

/** Two command lists are the same memo (sealing sends exactly what was previewed). */
export const sameMemo = (a: readonly CeoCommand[] | null, b: readonly CeoCommand[] | null): boolean =>
  a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
