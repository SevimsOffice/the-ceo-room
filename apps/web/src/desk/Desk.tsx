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

/**
 * The office: the Desk (the CEO's office at night) or, behind its tab, the Decision Room. Every
 * figure comes from the engine's selectors through the worker.
 */
export function Desk() {
  const t = useT();
  const loading = useGame((s) => s.report === null);
  const inRoom = useGame((s) => s.view === 'room' && s.room !== null);
  const failed = useGame((s) => s.fatal !== null);
  const newGame = useGame((s) => s.newGame);
  const confirming = useGame((s) => s.confirmingNewGame);
  const cancelNewGame = useGame((s) => s.cancelNewGame);

  return (
    <div className="relative h-[900px] w-[1440px] overflow-hidden bg-desk" data-testid="desk" data-view={inRoom ? 'room' : 'desk'}>
      <WoodGrain />
      <DeskPlanks />
      <LampLight />
      <Header />
      <main>
        {loading ? (
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
      {!inRoom && <DossierSheet />}
      {!inRoom && <OrderBookSheet />}
      {confirming && <ConfirmNewGame onCancel={cancelNewGame} onConfirm={newGame} />}
      <FatalSlip />
    </div>
  );
}
