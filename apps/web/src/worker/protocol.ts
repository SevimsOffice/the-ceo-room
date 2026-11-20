/**
 * Messages between the Desk (main thread) and the engine worker. The worker owns the engine; the
 * Desk only sends intents and reads selector output. Everything here is structured-clone safe.
 */
import type {
  AdvisorBrief,
  CeoCommand,
  Command,
  CustomDecisionPreview,
  DecisionImpacts,
  DecisionStatus,
  MorningReportWithoutRunway,
  Msg,
  OrderBook,
  OverallHealth,
  Runway,
  SaveGame,
  SeedBundle,
} from '@ceo-room/engine';
import type { Directory } from '@ceo-room/i18n';

export type DeskReport = MorningReportWithoutRunway;

/**
 * The save game as the Desk stores it: the engine's SaveGame plus the stateHash of the state it
 * leads to. After replay the hash is checked; a mismatch counts as a failed restore. Saves written
 * before the hash was added have none and are accepted on replay alone.
 */
export type StoredSave = SaveGame & { stateHash?: string };

/**
 * The read-only dossier of a decision (from selectDecisionSummary): no option impacts and no
 * forward run. The runway is not among `figures`; the Desk prints the live projected runway.
 */
export interface DossierView {
  id: string;
  /** folder number on the desk (from the decision id: dec-0002 → 2) */
  number: number;
  kind: 'supplierPrice' | 'discountDemand';
  status: 'open' | 'approved' | 'rejected' | 'expired';
  situation: Msg;
  openedDay: number;
  deadlineDay: number;
  daysLeft: number;
  defaultOptionId: string;
  options: { id: string; labelKey: string }[];
  figures: { code: string; value: number }[];
}

/**
 * What a custom decision memo may hold, read from the engine state when the room is computed: the
 * allow-listed instructions' choices and the engine's limits (COMMAND_LIMITS). The engine checks
 * every memo again on preview and on sealing; this only keeps the form from offering nonsense.
 */
export interface MemoCatalog {
  limits: { maxPurchaseQty: number; maxDiscountBps: number; maxPassThroughBps: number };
  /** supplier offers: placePurchaseOrder needs one; switchSupplier needs one for the material */
  offers: { supplierId: string; materialId: string }[];
  materials: { id: string; preferredSupplierId: string }[];
  customers: { id: string; discountBps: number }[];
  /** repriceOrders works only on the material of this decision's supplier price rise (else null) */
  repriceMaterialId: string | null;
  /** the discount demand being answered (else null) */
  demand: { customerId: string; discountBps: number } | null;
}

/**
 * Everything the Decision Room shows, from engine selectors (selectDecision, selectAdvisorBrief,
 * selectProjectedRunway) for one state `version`. Heavy (forward runs): computed in the worker
 * only when no advance is running, and posted with the version it belongs to.
 */
export interface RoomView {
  decisionId: string;
  number: number;
  kind: 'supplierPrice' | 'discountDemand';
  status: DecisionStatus;
  /** the day the figures are for */
  day: number;
  situation: Msg;
  /** the telegram that opened the decision */
  telegram: { id: string; day: number; severity: 'high' | 'medium' | 'low'; message: Msg } | null;
  openedDay: number;
  deadlineDay: number;
  daysLeft: number;
  /** the option rejecting runs (and the baseline of every delta) */
  defaultOptionId: string;
  chosenOptionId: string | null;
  options: { id: string; labelKey: string; assumptions: Msg[] }[];
  /** supporting figures without the runway (see `runway`) */
  figures: { code: string; value: number }[];
  runway: Runway;
  /** +7 / +30 impacts of every option against the baseline (open decisions only) */
  impacts: DecisionImpacts | null;
  /** requested analysis: +7 / +30 / +90 impacts once ready */
  analysis: { requestedDay: number; readyDay: number; ready: boolean; extended: DecisionImpacts | null } | null;
  /** CFO then COO (open decisions only) */
  advisors: AdvisorBrief[];
  memo: MemoCatalog | null;
}

/** Why a ledger line happened: the CEO's instruction, an earlier line, or an engine rule. */
export type LedgerCause =
  | { kind: 'command'; commandId: string; commandType: string }
  | { kind: 'event'; seq: number }
  | { kind: 'rule'; ruleId: string };

export interface LedgerLine {
  seq: number;
  day: number;
  code: string;
  params: Msg['params'];
  cause: LedgerCause;
}

/** The ledger entries of the latest decision taken (or expired), for the carbon copy on the Desk. */
export interface LedgerSlip {
  decisionId: string;
  status: Exclude<DecisionStatus, 'open'>;
  /** null for a custom decision or a default that could not run */
  optionId: string | null;
  /** the option's label key (null when no option ran) */
  optionLabelKey: string | null;
  custom: boolean;
  day: number;
  lines: LedgerLine[];
  /** lines left out of `lines` (the slip keeps the first ones) */
  more: number;
  /** who an order (customer) or purchase order (supplier) named in `lines` is with, where known */
  parties: Record<string, LedgerParty>;
  /** the label key of each option of the decision, so a line naming an option prints its label */
  options: Record<string, string>;
}

/** The counterparty of an order or a purchase order, so the slip can name it instead of its id. */
export interface LedgerParty {
  kind: 'customer' | 'supplier';
  id: string;
}

/** Engine thresholds the Desk needs to word a figure (from the engine's tuning). */
export interface DeskThresholds {
  capacityComfortBps: number;
  capacityMaxBps: number;
  /** runway gauge danger zone: this many days and fewer (tuning.RUNWAY_DANGER_DAYS) */
  runwayDangerDays: number;
  /** the runway projection's horizon (settings.runwayHorizonDays): the gauge's full sweep */
  runwayHorizonDays: number;
}

export type WorkerRequest =
  /**
   * start the engine, from a saved game when given. `bundle`: the company to run (My company,
   * imported); without it, the sample NOVARA. `newGame` and restores keep to this company.
   */
  | { type: 'init'; save: StoredSave | null; unreadable?: boolean; bundle?: SeedBundle | null }
  /** throw the game away and start again at Day 1 */
  | { type: 'newGame' }
  | { type: 'dispatch'; command: Command }
  /** advance N days, one day at a time, posting a report after each */
  | { type: 'advance'; days: number }
  /** interrupt a running advance after the current day */
  | { type: 'stop' }
  | { type: 'openDecision'; decisionId: string }
  | { type: 'openOrderBook' }
  /**
   * open the Decision Room on a decision: its view is posted now and after every state change.
   * Also sent when the CEO comes back to the room from the Desk (the view is recalculated once).
   */
  | { type: 'openRoom'; decisionId: string }
  /** the room is closed, or behind its tab while the Desk is in front: stop recalculating it */
  | { type: 'closeRoom' }
  /** preview a custom decision memo (+7 / +30) without changing anything */
  | { type: 'previewCustom'; requestId: number; decisionId: string; commands: CeoCommand[] }
  /** the memo was put away: a preview not yet calculated is dropped (a newer previewCustom also drops older ones) */
  | { type: 'cancelPreview' };

export type WorkerResponse =
  | {
      type: 'ready';
      directory: Directory;
      currency: string;
      thresholds: DeskThresholds;
      restored: boolean;
      /**
       * set when a saved game was given but could not be restored (a new game started instead).
       * Posted before the first `save`, so the Desk can keep the old save as a backup first.
       */
      restoreError: Msg | null;
    }
  /** the engine failed (an exception in the worker): the Desk offers a new game */
  | { type: 'fatal'; error: Msg }
  /** the morning report after every state change; `version` increases with each change */
  | { type: 'report'; version: number; report: DeskReport }
  /** the projected runway and overall health for report `version`, computed after it was posted */
  | { type: 'runway'; version: number; day: number; runway: Runway; health: OverallHealth }
  /** the save game after every state change (the Desk stores it) */
  | { type: 'save'; save: StoredSave }
  /** an advance started (busy) or ended (null) */
  | { type: 'busy'; busy: { fromDay: number; toDay: number } | null; interrupted?: boolean }
  | { type: 'dispatched'; ok: true; command: Command }
  | { type: 'dispatched'; ok: false; command: Command; error: Msg }
  /** a request that changes state arrived while an advance was running */
  | { type: 'rejected'; request: WorkerRequest['type']; reason: 'busy' | 'notReady' }
  | { type: 'dossier'; decisionId: string; view: DossierView | null }
  | { type: 'orderBook'; book: OrderBook }
  /** the Decision Room for report `version` (null: no such decision) */
  | { type: 'room'; decisionId: string; version: number; view: RoomView | null }
  /**
   * a memo's preview for report `version`: `ready` (the engine's impact, or its CommandError in
   * `preview.impact.error`), `closed` (the decision is no longer open) or `busy` (days are running)
   */
  | { type: 'customPreview'; requestId: number; decisionId: string; version: number; status: 'ready' | 'closed' | 'busy'; preview: CustomDecisionPreview | null }
  /** the ledger entries of the latest decision closed (posted when it changes; none before the first) */
  | { type: 'ledgerSlip'; slip: LedgerSlip };
