import type { CompanyState, Msg, WorkspaceId } from './model/types';
import type { Command, DispatchResult } from './commands/types';
import { advanceState, applyCommand } from './core';
import type { GameEvent } from './events/types';
import { fnv1a } from './rng/rng';
import { type ProjectionResult, projectState } from './projection/project';
import { type EngineOptions, bootstrap } from './seed/init';
import type { SeedBundle } from './seed/types';

export type LogEntry = { kind: 'dispatch'; command: Command } | { kind: 'advance'; days: number };

/** Save game (ADR-0005): seed version + RNG seed + command log. Load = replay. */
export interface SaveGame {
  format: 1;
  seedVersion: number;
  rngSeed: number;
  workspaceId: WorkspaceId;
  log: LogEntry[];
}

export interface Engine {
  state(): Readonly<CompanyState>;
  dispatch(cmd: Command): DispatchResult<GameEvent>;
  advance(days: number): GameEvent[];
  project(cmds: Command[], days: number, checkpoints?: number[]): ProjectionResult;
  ledger(): readonly GameEvent[];
  snapshot(): SaveGame;
}

export function createEngine(seed: SeedBundle, opts: EngineOptions): Engine {
  const boot = bootstrap(seed, opts);
  let current = boot.state;
  const ledger: GameEvent[] = [...boot.events];
  const log: LogEntry[] = [];
  return {
    state: () => current,
    dispatch(cmd) {
      const r = applyCommand(current, cmd);
      if (!r.ok) return r;
      current = r.state;
      ledger.push(...r.events);
      log.push({ kind: 'dispatch', command: JSON.parse(JSON.stringify(cmd)) as Command });
      return { ok: true, commandId: r.commandId, events: r.events };
    },
    advance(days) {
      const n = Math.max(0, Math.floor(days));
      if (n === 0) return [];
      const r = advanceState(current, n);
      current = r.state;
      ledger.push(...r.events);
      log.push({ kind: 'advance', days: n });
      return r.events;
    },
    project: (cmds, days, checkpoints) => projectState(current, cmds, days, checkpoints),
    ledger: () => ledger,
    snapshot: () => ({
      format: 1,
      seedVersion: current.seedVersion,
      rngSeed: current.rngSeed,
      workspaceId: current.workspaceId,
      log: JSON.parse(JSON.stringify(log)) as LogEntry[],
    }),
  };
}

/** Rebuild an engine by replaying a save game against the same seed. */
export function fromSnapshot(seed: SeedBundle, save: SaveGame): { ok: true; engine: Engine } | { ok: false; error: Msg } {
  if (save.format !== 1) return { ok: false, error: { code: 'error.saveFormat', params: { format: save.format } } };
  const seedVersion = seed.company.company.seedVersion;
  if (save.seedVersion !== seedVersion) {
    return { ok: false, error: { code: 'error.seedVersionMismatch', params: { save: save.seedVersion, seed: seedVersion } } };
  }
  const engine = createEngine(seed, { rngSeed: save.rngSeed, workspaceId: save.workspaceId });
  for (const entry of save.log) {
    if (entry.kind === 'advance') engine.advance(entry.days);
    else {
      const r = engine.dispatch(entry.command);
      if (!r.ok) return { ok: false, error: { code: 'error.replayFailed', params: { reason: r.error.code } } };
    }
  }
  return { ok: true, engine };
}

/** Stable hash of a state (determinism tests, save verification). */
export function stateHash(s: CompanyState): string {
  return fnv1a(JSON.stringify(s)).toString(16).padStart(8, '0');
}
