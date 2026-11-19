/**
 * The Desk's state: the latest selector output posted by the engine worker, plus what is open on
 * the desk. Nothing here computes a figure; every number arrives from the worker.
 */
import { create } from 'zustand';
import type { Msg, OrderBook, OverallHealth, Runway } from '@ceo-room/engine';
import type { Directory, Locale } from '@ceo-room/i18n';
import type { DeskReport, DeskThresholds, DossierView, WorkerRequest, WorkerResponse } from '../worker/protocol';
import { backupSave, loadLocale, storeLocale, storeSave } from './storage';

/** Auto-advance pace when playing. */
export const PLAY_INTERVAL_MS = 1500;

export interface Transport {
  send(msg: WorkerRequest): void;
  /** start a fresh worker with no save (after a fatal error); without it, `newGame` is sent */
  restart?(): void;
}

export interface GameState {
  locale: Locale;
  phase: 'loading' | 'ready';
  report: DeskReport | null;
  version: number;
  /** runway + health for `version` (stale ones are dropped) */
  runway: { version: number; runway: Runway; health: OverallHealth } | null;
  directory: Directory | null;
  currency: string;
  thresholds: DeskThresholds | null;
  busy: { fromDay: number; toDay: number } | null;
  /**
   * an advance was sent and its `busy: null` has not come back yet. Set synchronously on sending,
   * so a second ring of the bell before the worker answers cannot advance twice.
   */
  advancePending: boolean;
  playing: boolean;
  /** the engine failed (worker exception or crash): the Desk shows the error slip */
  fatal: Msg | null;
  /** a note for the status slip (restore failed, command refused): `key` with `{reason}` = detail */
  notice: { key: string; detail: Msg } | null;
  dossier: { decisionId: string; view: DossierView | null; loaded: boolean } | null;
  orderBook: { book: OrderBook | null } | null;
  /** the "start a new game?" sheet is open */
  confirmingNewGame: boolean;
  /** telegram ids already shown once (new ones slide in) */
  seenTelegrams: Record<string, true>;

  setLocale(locale: Locale): void;
  advance(days: number): void;
  play(): void;
  pause(): void;
  acknowledge(developmentId: string): void;
  openDossier(decisionId: string): void;
  closeDossier(): void;
  openOrderBook(): void;
  closeOrderBook(): void;
  askNewGame(): void;
  cancelNewGame(): void;
  newGame(): void;
  markTelegramsSeen(ids: string[]): void;
  dismissNotice(): void;
  receive(msg: WorkerResponse): void;
}

let transport: Transport = { send: () => {} };
let playTimer: ReturnType<typeof setInterval> | null = null;

/** Connect the store to the worker (or to a fake in tests). */
export function setTransport(t: Transport): void {
  transport = t;
}

const stopTimer = (): void => {
  if (playTimer !== null) clearInterval(playTimer);
  playTimer = null;
};

/** A sheet of paper is over the desk (dossier, order book, new-game question): auto-play waits. */
export const sheetOpen = (s: Pick<GameState, 'dossier' | 'orderBook' | 'confirmingNewGame'>): boolean =>
  s.dossier !== null || s.orderBook !== null || s.confirmingNewGame;

/** Whether a new advance may be sent now. */
const canAdvance = (s: GameState): boolean => s.phase === 'ready' && !s.busy && !s.advancePending && !s.fatal;

export const useGame = create<GameState>()((set, get) => ({
  locale: loadLocale(),
  phase: 'loading',
  report: null,
  version: 0,
  runway: null,
  directory: null,
  currency: 'TRY',
  thresholds: null,
  busy: null,
  advancePending: false,
  playing: false,
  fatal: null,
  notice: null,
  dossier: null,
  orderBook: null,
  confirmingNewGame: false,
  seenTelegrams: {},

  setLocale(locale) {
    storeLocale(locale);
    set({ locale });
  },

  advance(days) {
    const s = get();
    if (!canAdvance(s) || s.playing) return;
    set({ advancePending: true });
    transport.send({ type: 'advance', days });
  },

  play() {
    const s = get();
    if (!canAdvance(s) || s.playing) return;
    set({ playing: true });
    stopTimer();
    playTimer = setInterval(() => {
      const now = get();
      if (!now.playing) return stopTimer();
      // the clock waits while a day is running or a sheet is open on the desk
      if (!canAdvance(now) || sheetOpen(now)) return;
      set({ advancePending: true });
      transport.send({ type: 'advance', days: 1 });
    }, PLAY_INTERVAL_MS);
  },

  pause() {
    stopTimer();
    set({ playing: false });
    transport.send({ type: 'stop' });
  },

  acknowledge(developmentId) {
    if (get().busy) return;
    transport.send({ type: 'dispatch', command: { type: 'acknowledgeDevelopment', developmentId } });
  },

  openDossier(decisionId) {
    set({ dossier: { decisionId, view: null, loaded: false }, orderBook: null });
    transport.send({ type: 'openDecision', decisionId });
  },
  closeDossier: () => set({ dossier: null }),

  openOrderBook() {
    set({ orderBook: { book: null }, dossier: null });
    transport.send({ type: 'openOrderBook' });
  },
  closeOrderBook: () => set({ orderBook: null }),

  askNewGame: () => set({ confirmingNewGame: true }),
  cancelNewGame: () => set({ confirmingNewGame: false }),

  newGame() {
    const crashed = get().fatal !== null;
    stopTimer();
    // after a failure the save may be what broke: keep it as the backup before clearing it
    if (crashed) backupSave();
    storeSave(null);
    set({
      playing: false,
      dossier: null,
      orderBook: null,
      notice: null,
      seenTelegrams: {},
      confirmingNewGame: false,
      advancePending: false,
      fatal: null,
      // a restarted worker counts its report versions from 1 again
      ...(crashed ? { phase: 'loading' as const, report: null, version: 0, runway: null, busy: null } : {}),
    });
    if (crashed && transport.restart) transport.restart();
    else transport.send({ type: 'newGame' });
  },

  dismissNotice: () => set({ notice: null }),

  markTelegramsSeen(ids) {
    const seen = get().seenTelegrams;
    if (ids.every((id) => seen[id])) return;
    set({ seenTelegrams: { ...seen, ...Object.fromEntries(ids.map((id) => [id, true as const])) } });
  },

  receive(msg) {
    switch (msg.type) {
      case 'ready':
        // keep the save that could not be restored before the new game's first save overwrites it
        if (msg.restoreError) backupSave();
        set({
          phase: 'ready',
          directory: msg.directory,
          currency: msg.currency,
          thresholds: msg.thresholds,
          notice: msg.restoreError ? { key: 'ui.status.restoreFailed', detail: msg.restoreError } : null,
        });
        return;
      case 'report': {
        const s = get();
        if (msg.version < s.version) return;
        const open = s.orderBook !== null;
        set({ report: msg.report, version: msg.version });
        // keep an open sheet live; the dossier only between advances (it is re-read at busy: null)
        if (open) transport.send({ type: 'openOrderBook' });
        if (s.dossier && !s.busy && !s.advancePending) transport.send({ type: 'openDecision', decisionId: s.dossier.decisionId });
        return;
      }
      case 'runway':
        if (msg.version === get().version) set({ runway: { version: msg.version, runway: msg.runway, health: msg.health } });
        return;
      case 'save':
        storeSave(msg.save);
        return;
      case 'busy': {
        if (msg.busy) {
          set({ busy: msg.busy });
          return;
        }
        set({ busy: null, advancePending: false });
        const d = get().dossier;
        if (d) transport.send({ type: 'openDecision', decisionId: d.decisionId });
        return;
      }
      case 'dispatched':
        if (!msg.ok) set({ notice: { key: 'ui.status.commandFailed', detail: msg.error } });
        return;
      case 'rejected':
        if (msg.request === 'advance') set({ advancePending: false });
        return;
      case 'fatal':
        stopTimer();
        set({ fatal: msg.error, playing: false, advancePending: false, busy: null });
        return;
      case 'dossier': {
        const d = get().dossier;
        if (d && d.decisionId === msg.decisionId) set({ dossier: { decisionId: msg.decisionId, view: msg.view, loaded: true } });
        return;
      }
      case 'orderBook':
        if (get().orderBook) set({ orderBook: { book: msg.book } });
        return;
    }
  },
}));

/** Runway and health for the report on the desk, or null while they are being calculated. */
export function currentRunway(s: Pick<GameState, 'runway' | 'version'>): GameState['runway'] {
  return s.runway && s.runway.version === s.version ? s.runway : null;
}
