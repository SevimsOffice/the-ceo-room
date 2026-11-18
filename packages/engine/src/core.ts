import type { CompanyState } from './model/types';
import type { Command, CommandError } from './commands/types';
import { handleCommand } from './commands/handle';
import { Tx, fromCommand } from './events/tx';
import type { GameEvent } from './events/types';
import { closeDay, openDay } from './systems/tick';

/**
 * Pure state transitions. Each returns a NEW state; the input is never mutated.
 */
export type CommandOutcome =
  | { ok: true; state: CompanyState; events: GameEvent[]; commandId: string }
  | { ok: false; error: CommandError };

export function applyCommand(state: CompanyState, cmd: Command): CommandOutcome {
  const tx = new Tx(state);
  const commandId = `cmd-${String(tx.s.nextCommandSeq).padStart(4, '0')}`;
  const cause = fromCommand(commandId);
  tx.emit('CommandAccepted', { commandId, commandType: cmd.type }, cause, { commandId, commandType: cmd.type });
  const error = handleCommand(tx, cmd, cause);
  if (error) return { ok: false, error };
  tx.flushRng(fromCommand(commandId));
  return { ok: true, state: tx.s, events: tx.events, commandId };
}

/** Run `days` full days: evening of today, morning of tomorrow. */
export function advanceState(state: CompanyState, days: number): { state: CompanyState; events: GameEvent[] } {
  let s = state;
  const events: GameEvent[] = [];
  const n = Math.max(0, Math.floor(days));
  for (let i = 0; i < n; i++) {
    const tx = new Tx(s);
    closeDay(tx);
    openDay(tx, tx.s.day + 1);
    s = tx.s;
    for (const e of tx.events) events.push(e);
  }
  return { state: s, events };
}
