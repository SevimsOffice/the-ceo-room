/**
 * Read models of the Decision Room and the Desk's ledger slip, built in the worker from engine
 * selectors and the engine's ledger. Plain functions of the engine: no posting, no timing.
 */
import {
  COMMAND_LIMITS,
  type CompanyState,
  type Decision,
  type Engine,
  type GameEvent,
  selectAdvisorBrief,
  selectDecision,
  selectProjectedRunway,
} from '@ceo-room/engine';
import type { LedgerCause, LedgerLine, LedgerSlip, MemoCatalog, RoomView } from './protocol';

const decisionNumber = (id: string): number => Number(/(\d+)$/.exec(id)?.[1] ?? 0);

/** What a custom memo may hold on this decision (choices and limits; the engine checks again). */
export function memoCatalog(s: Readonly<CompanyState>, d: Readonly<Decision>): MemoCatalog {
  return {
    limits: { maxPurchaseQty: COMMAND_LIMITS.maxPurchaseQty, maxDiscountBps: COMMAND_LIMITS.maxDiscountBps, maxPassThroughBps: 10000 },
    offers: s.suppliers.flatMap((sup) => sup.offers.map((o) => ({ supplierId: sup.id, materialId: o.materialId }))),
    materials: s.materials.map((m) => ({ id: m.id, preferredSupplierId: m.preferredSupplierId })),
    customers: s.customers.map((c) => ({ id: c.id, discountBps: c.discountBps })),
    repriceMaterialId: d.basis.kind === 'supplierPrice' ? d.basis.materialId : null,
    demand: d.basis.kind === 'discountDemand' ? { customerId: d.basis.customerId, discountBps: d.basis.discountBps } : null,
  };
}

/** The Decision Room for one decision on the engine's current state (null: unknown decision). */
export function roomView(e: Engine, decisionId: string): RoomView | null {
  const s = e.state();
  const v = selectDecision(s, decisionId);
  if (!v) return null;
  const d = v.decision;
  const open = d.status === 'open';
  const dev = s.developments.find((x) => x.id === d.developmentId);
  const briefs = open ? [selectAdvisorBrief(s, 'cfo', d.id), selectAdvisorBrief(s, 'coo', d.id)] : [];
  return {
    decisionId: d.id,
    number: decisionNumber(d.id),
    kind: d.kind,
    status: d.status,
    day: s.day,
    situation: v.situation,
    telegram: dev ? { id: dev.id, day: dev.day, severity: dev.severity, message: dev.message } : null,
    openedDay: d.openedDay,
    deadlineDay: d.deadlineDay,
    daysLeft: d.deadlineDay - s.day,
    defaultOptionId: d.defaultOptionId,
    chosenOptionId: d.chosenOptionId,
    options: d.options.map((o) => ({ id: o.id, labelKey: o.labelKey, assumptions: o.assumptions })),
    // the runway goes separately, with its cap (printed "180+ gün")
    figures: v.supportingFigures.filter((f) => f.code !== 'figure.runwayDays').map((f) => ({ code: f.code, value: f.value })),
    runway: selectProjectedRunway(s),
    impacts: v.impacts,
    analysis: v.analysis,
    advisors: briefs.filter((b) => b !== null),
    memo: open ? memoCatalog(s, d) : null,
  };
}

/** Lines the slip shows at most. */
export const SLIP_LINES = 40;
/** How far after the decision's own line its consequences are looked for. */
const SCAN_AFTER = 600;

/**
 * Follows the ledger and keeps the latest DecisionResolved. Only the new part of the ledger is
 * read on each call, so a long game costs nothing extra per day.
 */
export function createLedgerTracker() {
  let scanned = 0;
  let last = -1;
  let posted = -1;
  return {
    reset() {
      scanned = 0;
      last = -1;
      posted = -1;
    },
    /** The slip when a newer decision was closed since the last call; undefined when unchanged. */
    update(e: Engine): LedgerSlip | undefined {
      const ledger = e.ledger();
      for (let i = scanned; i < ledger.length; i++) if (ledger[i]!.type === 'DecisionResolved') last = i;
      scanned = ledger.length;
      if (last < 0) return undefined;
      const seq = ledger[last]!.seq;
      if (seq === posted) return undefined;
      posted = seq;
      return ledgerSlip(e.state(), ledger, last);
    },
  };
}

/** The resolution at `index` and every ledger line it caused (directly or through other lines). */
export function ledgerSlip(s: Readonly<CompanyState>, ledger: readonly GameEvent[], index: number): LedgerSlip {
  const root = ledger[index]!;
  if (root.type !== 'DecisionResolved') throw new Error('not a DecisionResolved line');
  const commandTypes = new Map<string, string>();
  const included = new Set<number>();
  const lines: GameEvent[] = [];
  let start = index;
  if (root.cause.kind === 'command') {
    const id = root.cause.commandId;
    // the instruction's own CommandAccepted line opens its transaction
    for (let i = index - 1; i >= 0 && i >= index - SCAN_AFTER; i--) {
      const ev = ledger[i]!;
      if (ev.type === 'CommandAccepted' && ev.payload.commandId === id) {
        start = i;
        break;
      }
    }
  } else if (root.cause.kind === 'event') {
    // an expiry whose default failed: the failure line comes first
    const causeSeq = root.cause.seq;
    const j = ledger.findIndex((ev, i) => i >= index - SCAN_AFTER && i < index && ev.seq === causeSeq);
    if (j >= 0) start = j;
  }
  const commandId = root.cause.kind === 'command' ? root.cause.commandId : null;
  for (let i = start; i < ledger.length && i <= index + SCAN_AFTER; i++) {
    const ev = ledger[i]!;
    if (ev.type === 'CommandAccepted') commandTypes.set(ev.payload.commandId, ev.payload.commandType);
    const mine =
      i === start ||
      ev.seq === root.seq ||
      (commandId !== null && ev.cause.kind === 'command' && ev.cause.commandId === commandId) ||
      (ev.cause.kind === 'event' && included.has(ev.cause.seq));
    if (!mine) continue;
    included.add(ev.seq);
    if (ev.type !== 'RngAdvanced') lines.push(ev);
  }
  const cause = (ev: GameEvent): LedgerCause => {
    if (ev.cause.kind === 'command') return { kind: 'command', commandId: ev.cause.commandId, commandType: commandTypes.get(ev.cause.commandId) ?? '' };
    if (ev.cause.kind === 'event') return { kind: 'event', seq: ev.cause.seq };
    return { kind: 'rule', ruleId: ev.cause.ruleId };
  };
  const p = root.payload;
  const d = s.decisions.find((x) => x.id === p.decisionId);
  const label = p.optionId !== null ? (d?.options.find((o) => o.id === p.optionId)?.labelKey ?? null) : null;
  const shown: LedgerLine[] = lines.slice(0, SLIP_LINES).map((ev) => ({ seq: ev.seq, day: ev.day, code: ev.code, params: ev.params, cause: cause(ev) }));
  return {
    decisionId: p.decisionId,
    status: p.status,
    optionId: p.optionId,
    optionLabelKey: label,
    custom: p.custom !== null,
    day: root.day,
    lines: shown,
    more: Math.max(0, lines.length - SLIP_LINES),
  };
}
