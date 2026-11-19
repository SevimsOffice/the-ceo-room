/**
 * The Desk's state: the latest selector output posted by the engine worker, plus what is open on
 * the desk. Nothing here computes a figure; every number arrives from the worker.
 */
import { create } from 'zustand';
import type { CeoCommand, Command, CustomDecisionPreview, Msg, OrderBook, OverallHealth, Runway } from '@ceo-room/engine';
import type { Directory, Locale } from '@ceo-room/i18n';
import type { DeskReport, DeskThresholds, DossierView, LedgerSlip, RoomView, WorkerRequest, WorkerResponse } from '../worker/protocol';
import { backupSave, loadLocale, storeLocale, storeSave } from './storage';

/** Auto-advance pace when playing. */
export const PLAY_INTERVAL_MS = 1500;

export interface Transport {
  send(msg: WorkerRequest): void;
  /** start a fresh worker with no save (after a fatal error); without it, `newGame` is sent */
  restart?(): void;
}

/** A decision command the Decision Room sends (the room waits for its answer). */
export type RoomAction = 'approve' | 'reject' | 'analysis' | 'custom';

/** A custom decision memo sent for preview, and what came back. */
export interface MemoPreview {
  requestId: number;
  /** the instructions previewed (sealing sends exactly these) */
  commands: CeoCommand[];
  /** `waiting` until the worker answers */
  status: 'waiting' | 'ready' | 'closed' | 'busy';
  /** the report version the preview was computed for */
  version: number;
  preview: CustomDecisionPreview | null;
}

export interface RoomState {
  decisionId: string;
  /** the latest view; current only when `view.version` equals the report version */
  view: { version: number; data: RoomView | null } | null;
  /** the option chosen for the seal (not the default: rejecting runs that) */
  selected: string | null;
  /** a decision command sent and not yet answered */
  pending: RoomAction | null;
  /** the custom decision memo is open */
  memoOpen: boolean;
  memo: MemoPreview | null;
  /**
   * the engine took the decision: the room shows its last view (frozen) until the seal or stamp has
   * come down, then gives way to the Desk. The command was sent at the press, not after it.
   */
  leaving?: boolean;
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
  /** which room is in front: the Desk or the Decision Room */
  view: 'desk' | 'room';
  /** the decision open in the Decision Room (its tab shows while this is set) */
  room: RoomState | null;
  /** the ledger entries of the latest decision closed, and whether the carbon copy is open */
  ledgerSlip: LedgerSlip | null;
  ledgerOpen: boolean;
  /** a decision just taken in the room: its carbon copy opens when its slip arrives */
  slipFor: string | null;

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
  /** open the Decision Room on a decision (from a telegram, a folder or a dossier) */
  openRoom(decisionId: string): void;
  /**
   * back to the Desk; the room stays open behind its tab, but the worker stops recalculating it
   * (and its memo preview) until the CEO returns. Refused while a decision is being sent.
   */
  showDesk(): void;
  /** back to the room: its view (and an open memo's preview) is recalculated once, for today */
  showRoom(): void;
  /** put the decision back in its folder: the room and its tab go away */
  closeRoom(): void;
  selectOption(optionId: string): void;
  /**
   * press the seal on the selected option. The command is sent at once; `pressMs` is how long the
   * seal takes to come down, during which the room stays in front once the engine has answered.
   */
  approve(pressMs?: number): void;
  /** the ink stamp: runs the default option (sent at once, like the seal) */
  reject(pressMs?: number): void;
  requestAnalysis(): void;
  openMemo(): void;
  closeMemo(): void;
  previewMemo(commands: CeoCommand[]): void;
  /** seal the previewed memo (only when its preview is current and the engine accepted it) */
  sealMemo(pressMs?: number): void;
  openLedger(): void;
  closeLedger(): void;
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

/**
 * A sheet of paper is over the desk (dossier, order book, carbon copy, new-game question) or the
 * Decision Room is in front: auto-play waits.
 */
export const sheetOpen = (s: Pick<GameState, 'dossier' | 'orderBook' | 'confirmingNewGame'> & Partial<Pick<GameState, 'view' | 'ledgerOpen'>>): boolean =>
  s.dossier !== null || s.orderBook !== null || s.confirmingNewGame || s.view === 'room' || s.ledgerOpen === true;

/**
 * The room view for the report on the desk, or null while it is being (re)calculated. While the
 * room is leaving (the decision was taken) its last view stays in front until the press ends.
 */
export function currentRoomView(s: Pick<GameState, 'room' | 'version'>): RoomView | null {
  const v = s.room?.view;
  if (s.room?.leaving) return v?.data ?? null;
  return v && v.version === s.version ? v.data : null;
}

/** The memo preview for the report on the desk (null when none, waiting or out of date). */
export function currentMemoPreview(s: Pick<GameState, 'room' | 'version'>): MemoPreview | null {
  const m = s.room?.memo;
  return m && m.status !== 'waiting' && m.version === s.version ? m : null;
}

/** The Decision Room may act now: its view is current and open, nothing is running or pending. */
export function canDecide(s: GameState): boolean {
  const v = currentRoomView(s);
  return s.phase === 'ready' && !s.busy && !s.advancePending && !s.fatal && s.room !== null && s.room.pending === null && v !== null && v.status === 'open';
}

let memoRequest = 0;

/**
 * The seal or stamp coming down on a decision (visual only: its command was already sent). When
 * the engine answers before it is down, the room waits for it before giving way to the Desk.
 */
let press: { decisionId: string; done: boolean; timer: ReturnType<typeof setTimeout> | null } | null = null;

function startPress(decisionId: string, ms: number): void {
  if (press?.timer) clearTimeout(press.timer);
  const p: NonNullable<typeof press> = { decisionId, done: !(ms > 0), timer: null };
  press = p;
  if (p.done) return;
  p.timer = setTimeout(() => {
    p.done = true;
    p.timer = null;
    finishLeaving();
  }, ms);
}

/** The decision is taken and its press is down: the room goes, the Desk (and carbon copy) is in front. */
function finishLeaving(): void {
  const r = useGame.getState().room;
  if (!r?.leaving) return;
  if (press && press.decisionId === r.decisionId && !press.done) return;
  press = null;
  useGame.setState({ room: null, view: 'desk' });
}

const DECIDING: readonly Command['type'][] = ['approveOption', 'rejectDecision', 'customDecision'];

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
  view: 'desk',
  room: null,
  ledgerSlip: null,
  ledgerOpen: false,
  slipFor: null,

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
      view: 'desk',
      room: null,
      ledgerSlip: null,
      ledgerOpen: false,
      slipFor: null,
      // a restarted worker counts its report versions from 1 again
      ...(crashed ? { phase: 'loading' as const, report: null, version: 0, runway: null, busy: null } : {}),
    });
    if (crashed && transport.restart) transport.restart();
    else transport.send({ type: 'newGame' });
  },

  dismissNotice: () => set({ notice: null }),

  openRoom(decisionId) {
    const s = get();
    if (s.room?.decisionId === decisionId) return s.showRoom();
    if (s.room?.pending) return;
    set({ view: 'room', dossier: null, orderBook: null, ledgerOpen: false });
    set({ room: { decisionId, view: null, selected: null, pending: null, memoOpen: false, memo: null } });
    transport.send({ type: 'openRoom', decisionId });
  },
  showDesk() {
    const s = get();
    if (s.view === 'desk') return;
    // a decision being sent keeps the room in front until the engine answers
    if (s.room?.pending) return;
    set({ view: 'desk' });
    // the room behind its tab is not recalculated while the Desk is in front
    if (s.room) transport.send({ type: 'closeRoom' });
  },
  showRoom() {
    const s = get();
    const r = s.room;
    if (!r) return;
    set({ dossier: null, orderBook: null, ledgerOpen: false });
    if (s.view === 'room') return;
    set({ view: 'room' });
    // recalculated once for today's state (the worker re-posts its cached view when nothing changed)
    transport.send({ type: 'openRoom', decisionId: r.decisionId });
    refreshMemo();
  },
  closeRoom() {
    if (!get().room) return;
    set({ room: null, view: 'desk' });
    transport.send({ type: 'closeRoom' });
  },
  selectOption(optionId) {
    const r = get().room;
    const v = currentRoomView(get());
    if (!r || !v || r.pending || optionId === v.defaultOptionId || !v.options.some((o) => o.id === optionId)) return;
    set({ room: { ...r, selected: optionId } });
  },
  approve(pressMs = 0) {
    const s = get();
    const r = s.room;
    if (!r || !r.selected || !canDecide(s)) return;
    set({ room: { ...r, pending: 'approve' } });
    startPress(r.decisionId, pressMs);
    transport.send({ type: 'dispatch', command: { type: 'approveOption', decisionId: r.decisionId, optionId: r.selected } });
  },
  reject(pressMs = 0) {
    const s = get();
    const r = s.room;
    if (!r || !canDecide(s)) return;
    set({ room: { ...r, pending: 'reject' } });
    startPress(r.decisionId, pressMs);
    transport.send({ type: 'dispatch', command: { type: 'rejectDecision', decisionId: r.decisionId } });
  },
  requestAnalysis() {
    const s = get();
    const r = s.room;
    const v = currentRoomView(s);
    if (!r || !v || v.analysis || !canDecide(s)) return;
    set({ room: { ...r, pending: 'analysis' } });
    transport.send({ type: 'dispatch', command: { type: 'requestAnalysis', decisionId: r.decisionId } });
  },
  openMemo() {
    const r = get().room;
    if (r && currentRoomView(get())?.status === 'open') set({ room: { ...r, memoOpen: true } });
  },
  closeMemo() {
    const r = get().room;
    // the memo's lines go with the sheet: its preview is dropped (a late answer is ignored, and no
    // new preview is asked for after a day or a dispatch)
    if (!r) return;
    set({ room: { ...r, memoOpen: false, memo: null } });
    if (r.memo?.status === 'waiting') transport.send({ type: 'cancelPreview' });
  },
  previewMemo(commands) {
    const s = get();
    const r = s.room;
    if (!r || s.busy || s.advancePending) return;
    memoRequest += 1;
    const copy = JSON.parse(JSON.stringify(commands)) as CeoCommand[];
    set({ room: { ...r, memo: { requestId: memoRequest, commands: copy, status: 'waiting', version: s.version, preview: null } } });
    transport.send({ type: 'previewCustom', requestId: memoRequest, decisionId: r.decisionId, commands: copy });
  },
  sealMemo(pressMs = 0) {
    const s = get();
    const r = s.room;
    const m = currentMemoPreview(s);
    if (!r || !m || m.status !== 'ready' || !m.preview || m.preview.impact.error || !canDecide(s)) return;
    set({ room: { ...r, pending: 'custom' } });
    startPress(r.decisionId, pressMs);
    transport.send({ type: 'dispatch', command: { type: 'customDecision', decisionId: r.decisionId, commands: m.commands } });
  },
  openLedger() {
    if (get().ledgerSlip) set({ ledgerOpen: true });
  },
  closeLedger: () => set({ ledgerOpen: false }),

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
          // a (re)started engine has no room open and has posted no slip yet
          view: 'desk',
          room: null,
          ledgerSlip: null,
          ledgerOpen: false,
          slipFor: null,
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
        // the room view follows from the worker by itself; an open memo preview is asked again
        if (!s.busy && !s.advancePending) refreshMemo();
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
        refreshMemo();
        return;
      }
      case 'dispatched': {
        const r = get().room;
        const cmd = msg.command;
        const mine = r !== null && 'decisionId' in cmd && cmd.decisionId === r.decisionId;
        if (!msg.ok) {
          set({ notice: { key: 'ui.status.commandFailed', detail: msg.error }, ...(mine && r ? { room: { ...r, pending: null } } : {}) });
          return;
        }
        if (!mine || !r) return;
        if (DECIDING.includes(cmd.type)) {
          // the decision is taken: back to the Desk (once the seal is down), where the carbon copy
          // of its ledger lines waits
          set({ room: { ...r, leaving: true }, slipFor: r.decisionId });
          transport.send({ type: 'closeRoom' });
          finishLeaving();
        } else {
          set({ room: { ...r, pending: null } });
        }
        return;
      }
      case 'rejected':
        if (msg.request === 'advance') set({ advancePending: false });
        if (msg.request === 'dispatch') {
          const r = get().room;
          if (r?.pending) set({ room: { ...r, pending: null }, notice: { key: 'ui.status.commandFailed', detail: { code: 'ui.room.error.busy', params: {} } } });
        }
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
      case 'room': {
        const s = get();
        // a view for an older state is dropped: the worker follows with the current one
        if (!s.room || s.room.decisionId !== msg.decisionId || msg.version !== s.version) return;
        const data = msg.view;
        const selected = s.room.selected && data?.options.some((o) => o.id === s.room!.selected) ? s.room.selected : null;
        set({ room: { ...s.room, view: { version: msg.version, data }, selected } });
        return;
      }
      case 'customPreview': {
        const r = get().room;
        if (!r?.memo || r.memo.requestId !== msg.requestId || r.decisionId !== msg.decisionId) return;
        set({ room: { ...r, memo: { ...r.memo, status: msg.status, version: msg.version, preview: msg.preview } } });
        return;
      }
      case 'ledgerSlip': {
        const s = get();
        set({ ledgerSlip: msg.slip, ledgerOpen: s.ledgerOpen || s.slipFor === msg.slip.decisionId, slipFor: null });
        return;
      }
    }
  },
}));

/**
 * Ask again for a memo preview made for an older state (after a day or a dispatch), only while the
 * memo is open and the room is in front (on return from the Desk it is asked then).
 */
function refreshMemo(): void {
  const s = useGame.getState();
  const m = s.room?.memo;
  if (!m || !s.room?.memoOpen || s.view !== 'room' || s.room.leaving || m.status === 'waiting' || m.version === s.version) return;
  s.previewMemo(m.commands);
}

/** Runway and health for the report on the desk, or null while they are being calculated. */
export function currentRunway(s: Pick<GameState, 'runway' | 'version'>): GameState['runway'] {
  return s.runway && s.runway.version === s.version ? s.runway : null;
}
