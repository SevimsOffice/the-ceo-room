import type { CompanyState, I18nParams } from '../model/types';
import { mulberry32, type StreamName } from '../rng/rng';
import { applyEvent } from './reduce';
import type { Cause, EventOf, EventPayloads, EventType, GameEvent } from './types';

/** Deep clone for plain JSON state (no Dates, Maps or functions live in state). */
export function cloneState<T>(s: T): T {
  return JSON.parse(JSON.stringify(s)) as T;
}

/**
 * A transaction owns a private draft of the state. Systems read `tx.s` and change it only via
 * `emit`, which builds an event (seq, day, cause, i18n code) and runs it through the reducer.
 */
export class Tx {
  readonly s: CompanyState;
  readonly events: GameEvent[] = [];
  private pendingRng: Partial<Record<StreamName, number>> = {};

  constructor(base: CompanyState) {
    this.s = cloneState(base);
  }

  emit<K extends EventType>(type: K, payload: EventPayloads[K], cause: Cause, params: I18nParams = {}): EventOf<K> {
    const e = {
      seq: this.s.nextSeq,
      day: type === 'DayStarted' ? (payload as EventPayloads['DayStarted']).day : this.s.day,
      workspaceId: this.s.workspaceId,
      type,
      cause,
      code: `ledger.${type}`,
      params,
      payload,
    } as EventOf<K>;
    applyEvent(this.s, e);
    this.events.push(e);
    return e;
  }

  /** Draw a uint32 from a named stream. The advance is recorded by `flushRng`. */
  draw(stream: StreamName): number {
    const cur = this.pendingRng[stream] ?? this.s.rng[stream];
    const r = mulberry32(cur);
    this.pendingRng[stream] = r.state;
    return r.value;
  }

  /** Emit one RngAdvanced event for all draws since the last flush. */
  flushRng(cause: Cause): void {
    const keys = Object.keys(this.pendingRng);
    if (keys.length === 0) return;
    const streams = this.pendingRng;
    this.pendingRng = {};
    this.emit('RngAdvanced', { streams }, cause);
  }
}

export const rule = (ruleId: string): Cause => ({ kind: 'rule', ruleId });
export const fromEvent = (e: GameEvent): Cause => ({ kind: 'event', seq: e.seq });
export const fromCommand = (commandId: string): Cause => ({ kind: 'command', commandId });
