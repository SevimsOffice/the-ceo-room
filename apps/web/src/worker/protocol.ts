/**
 * Messages between the Desk (main thread) and the engine worker. The worker owns the engine; the
 * Desk only sends intents and reads selector output. Everything here is structured-clone safe.
 */
import type {
  Command,
  MorningReportWithoutRunway,
  Msg,
  OrderBook,
  OverallHealth,
  Runway,
  SaveGame,
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
  /** start the engine, from a saved game when given */
  | { type: 'init'; save: StoredSave | null; unreadable?: boolean }
  /** throw the game away and start again at Day 1 */
  | { type: 'newGame' }
  | { type: 'dispatch'; command: Command }
  /** advance N days, one day at a time, posting a report after each */
  | { type: 'advance'; days: number }
  /** interrupt a running advance after the current day */
  | { type: 'stop' }
  | { type: 'openDecision'; decisionId: string }
  | { type: 'openOrderBook' };

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
  | { type: 'orderBook'; book: OrderBook };
