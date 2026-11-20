import { useEffect, useRef } from 'react';
import { useT } from '../i18n';
import { useGame } from '../store/game';
import { DeskPlanks, FilmGrain, LampLight, Vignette, WoodGrain } from './Atmosphere';
import { CalendarLeaf } from './CalendarLeaf';
import { ConfirmNewGame } from './ConfirmNewGame';
import { DecisionFolders } from './DecisionFolders';
import { DeskBell } from './DeskBell';
import { DossierSheet } from './DossierSheet';
import { FatalSlip } from './FatalSlip';
import { GaugePanel } from './GaugePanel';
import { Header } from './Header';
import { OrderBookSheet } from './OrderBookSheet';
import { StatusSlip } from './StatusSlip';
import { TelegramStack } from './TelegramStack';
import { TimeDial } from './TimeDial';
import { TypedReport } from './TypedReport';
import { LedgerCarbon } from './LedgerCarbon';
import { DecisionRoom } from '../room/DecisionRoom';
import { ArchiveRoom } from '../archive/ArchiveRoom';

/**
 * Where focus goes on the Desk when the Decision Room on `decisionId` has closed (its controls are
 * gone): the carbon copy of that decision, else its telegram or folder, else the morning report.
 */
export function deskFocusTarget(root: ParentNode, decisionId: string | null): HTMLElement | null {
  const slip = root.querySelector<HTMLElement>('[data-testid=ledger-slip]');
  if (slip && decisionId !== null && slip.dataset.decision === decisionId) return slip;
  if (decisionId !== null) {
    const mine = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)].find((el) => el.dataset.decision === decisionId);
    const telegram = mine('[data-testid=telegram]')?.querySelector<HTMLElement>('button');
    if (telegram) return telegram;
    const folder = mine('[data-testid=decision-folder]');
    if (folder) return folder;
  }
  return root.querySelector<HTMLElement>('#report-title');
}

/**
 * The office: the Desk (the CEO's office at night) or, behind its tab, the Decision Room. Every
 * figure comes from the engine's selectors through the worker.
 */
export function Desk() {
  const t = useT();
  const loading = useGame((s) => s.report === null);
  const inRoom = useGame((s) => s.view === 'room' && s.room !== null);
  const inArchive = useGame((s) => s.view === 'archive');
  const failed = useGame((s) => s.fatal !== null);
  const newGame = useGame((s) => s.newGame);
  const confirming = useGame((s) => s.confirmingNewGame);
  const cancelNewGame = useGame((s) => s.cancelNewGame);
  const roomId = useGame((s) => s.room?.decisionId ?? null);
  const root = useRef<HTMLDivElement>(null);
  // the room closed (decision taken, or put back in its folder): focus lands on the Desk, not on
  // nothing. Going to the Desk by its tab keeps focus on the tab. An open carbon copy takes focus
  // itself and hands it to its slip when put away.
  const last = useRef({ inRoom, roomId });
  useEffect(() => {
    const prev = last.current;
    last.current = { inRoom, roomId };
    if (!prev.inRoom || inRoom || roomId !== null) return;
    if (useGame.getState().ledgerOpen) return;
    if (root.current) deskFocusTarget(root.current, prev.roomId)?.focus();
  }, [inRoom, roomId]);

  return (
    <div ref={root} className="relative h-[900px] w-[1440px] overflow-hidden bg-desk" data-testid="desk" data-view={inArchive ? 'archive' : inRoom ? 'room' : 'desk'}>
      <WoodGrain />
      <DeskPlanks />
      <LampLight />
      <Header />
      <main>
        {inArchive ? (
          // the Archive Room works while the engine (re)starts: switching companies happens here
          <ArchiveRoom />
        ) : loading ? (
          !failed && <p className="absolute left-0 top-[420px] w-full text-center font-hand text-3xl font-semibold italic text-cream-2" data-testid="loading">
            {t.t('ui.status.loading')}
          </p>
        ) : inRoom ? (
          <DecisionRoom />
        ) : (
          <>
            <div className="absolute left-[61px] top-[92px] z-10 w-[290px]">
              <DecisionFolders />
              <div className="mt-[18px]">
                <GaugePanel />
              </div>
            </div>
            <TypedReport />
            <TelegramStack />
            <CalendarLeaf />
            <TimeDial />
            <DeskBell />
            <LedgerCarbon />
          </>
        )}
        <StatusSlip />
      </main>
      <Vignette />
      <FilmGrain />
      {!inRoom && !inArchive && <DossierSheet />}
      {!inRoom && !inArchive && <OrderBookSheet />}
      {confirming && <ConfirmNewGame onCancel={cancelNewGame} onConfirm={newGame} />}
      <FatalSlip />
    </div>
  );
}
