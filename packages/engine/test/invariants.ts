/** Engine-wide invariants (SIMULATION_DESIGN §8). Returns human-readable violations; [] = all hold. */
import type { CompanyState, GameEvent } from '../src/index';

type HasWs = { workspaceId: string };

const RECORD_ARRAYS = [
  'departments',
  'workforce',
  'plants',
  'lines',
  'productFamilies',
  'materials',
  'suppliers',
  'customers',
  'orders',
  'purchaseOrders',
  'receivables',
  'payables',
  'recurringCosts',
  'periods',
  'eventCards',
  'developments',
  'decisions',
] as const satisfies readonly (keyof CompanyState)[];

/** cash = opening cash + Σ ReceivableCollected − Σ PayableSettled − Σ RecurringCostPaid */
export function cashFromLedger(state: Readonly<CompanyState>, ledger: readonly GameEvent[]): number {
  let cash = state.openingCash as number;
  for (const e of ledger) {
    if (e.type === 'ReceivableCollected') cash += e.payload.amount;
    else if (e.type === 'PayableSettled') cash -= e.payload.amount;
    else if (e.type === 'RecurringCostPaid') cash -= e.payload.amount;
  }
  return cash;
}

export function checkInvariants(state: Readonly<CompanyState>, ledger: readonly GameEvent[], ws: string): string[] {
  const v: string[] = [];

  // Cash conservation, integer money.
  if (!Number.isSafeInteger(state.cash)) v.push(`cash is not an integer: ${state.cash}`);
  const expected = cashFromLedger(state, ledger);
  if (expected !== state.cash) v.push(`cash ${state.cash} != opening + Σ cash events ${expected}`);

  // No negative stock.
  for (const m of state.materials) {
    if (m.stockQty < 0) v.push(`negative stock ${m.id}: ${m.stockQty}`);
    if (m.stockValue < 0) v.push(`negative stock value ${m.id}: ${m.stockValue}`);
  }

  // Single settlement; settlement events agree with the records.
  const settled = new Map<string, number>();
  const collected = new Map<string, number>();
  for (const e of ledger) {
    if (e.type === 'PayableSettled') {
      settled.set(e.payload.payableId, (settled.get(e.payload.payableId) ?? 0) + 1);
      const p = state.payables.find((x) => x.id === e.payload.payableId);
      if (!p) v.push(`settled unknown payable ${e.payload.payableId}`);
      else if (p.amount !== e.payload.amount) v.push(`payable ${p.id} settled for ${e.payload.amount}, record says ${p.amount}`);
    }
    if (e.type === 'ReceivableCollected') {
      collected.set(e.payload.receivableId, (collected.get(e.payload.receivableId) ?? 0) + 1);
      const r = state.receivables.find((x) => x.id === e.payload.receivableId);
      if (!r) v.push(`collected unknown receivable ${e.payload.receivableId}`);
      else if (r.amount !== e.payload.amount) v.push(`receivable ${r.id} collected ${e.payload.amount}, record says ${r.amount}`);
    }
  }
  for (const [id, n] of settled) if (n > 1) v.push(`payable ${id} settled ${n} times`);
  for (const [id, n] of collected) if (n > 1) v.push(`receivable ${id} collected ${n} times`);
  for (const p of state.payables) {
    const n = settled.get(p.id) ?? 0;
    if ((p.status === 'settled') !== (n === 1)) v.push(`payable ${p.id} status ${p.status} but ${n} settlement events`);
    if (p.status === 'open' && p.dueDay < state.day) v.push(`payable ${p.id} overdue and still open (due ${p.dueDay})`);
  }
  for (const r of state.receivables) {
    const n = collected.get(r.id) ?? 0;
    if ((r.status === 'collected') !== (n === 1)) v.push(`receivable ${r.id} status ${r.status} but ${n} collection events`);
    if (r.status === 'open' && r.expectedPayDay < state.day) v.push(`receivable ${r.id} past its pay day and still open (${r.expectedPayDay})`);
  }
  const rcvPerOrder = new Map<string, number>();
  for (const r of state.receivables) if (r.orderId) rcvPerOrder.set(r.orderId, (rcvPerOrder.get(r.orderId) ?? 0) + 1);
  for (const [id, n] of rcvPerOrder) if (n > 1) v.push(`order ${id} invoiced ${n} times`);

  // Ledger: seq strictly increasing, cause resolvable, workspace, i18n code.
  const seqs = new Set<number>();
  const commands = new Map<string, number>();
  let prevSeq = 0;
  let prevDay = Number.NEGATIVE_INFINITY;
  for (const e of ledger) {
    const tag = `event #${e.seq} ${e.type}`;
    if (!Number.isSafeInteger(e.seq) || e.seq <= prevSeq) v.push(`${tag}: seq not strictly increasing (prev ${prevSeq})`);
    if (e.day < prevDay) v.push(`${tag}: day ${e.day} before previous event day ${prevDay}`);
    prevSeq = e.seq;
    prevDay = e.day;
    if (e.workspaceId !== ws) v.push(`${tag}: workspaceId ${String(e.workspaceId)}`);
    if (e.code !== `ledger.${e.type}`) v.push(`${tag}: code ${String(e.code)}`);
    if (typeof e.params !== 'object' || e.params === null) v.push(`${tag}: params missing`);
    if (e.type === 'CommandAccepted') commands.set(e.payload.commandId, e.seq);
    const c = e.cause as GameEvent['cause'] | undefined;
    if (!c) v.push(`${tag}: no cause`);
    else if (c.kind === 'rule') {
      if (typeof c.ruleId !== 'string' || c.ruleId.length === 0) v.push(`${tag}: empty rule cause`);
    } else if (c.kind === 'event') {
      if (!(c.seq < e.seq && seqs.has(c.seq))) v.push(`${tag}: cause event #${c.seq} is not an earlier ledger event`);
    } else if (c.kind === 'command') {
      const at = commands.get(c.commandId);
      if (at === undefined || at > e.seq) v.push(`${tag}: cause command ${c.commandId} not accepted before it`);
    } else v.push(`${tag}: unknown cause kind`);
    seqs.add(e.seq);
  }
  const last = ledger[ledger.length - 1];
  if (last && state.nextSeq !== last.seq + 1) v.push(`state.nextSeq ${state.nextSeq} != last ledger seq + 1 (${last.seq + 1})`);

  // workspaceId on every record.
  if (state.workspaceId !== ws) v.push(`state.workspaceId ${state.workspaceId}`);
  if (state.company.workspaceId !== ws) v.push(`company.workspaceId ${state.company.workspaceId}`);
  for (const key of RECORD_ARRAYS) {
    const rows = state[key] as readonly HasWs[];
    rows.forEach((r, i) => {
      if (r.workspaceId !== ws) v.push(`${key}[${i}].workspaceId ${String(r.workspaceId)}`);
    });
  }
  return v;
}
