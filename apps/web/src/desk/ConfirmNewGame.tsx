import { useT } from '../i18n';
import { Sheet } from './Sheet';

/** Asks before throwing the current game away. */
export function ConfirmNewGame({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const t = useT();
  return (
    <Sheet title={t.t('ui.newGame.title')} onClose={onCancel} width={560} testId="confirm-new-game" role="alertdialog">
      <p className="m-0 mt-4 font-type text-label leading-relaxed">{t.t('ui.newGame.body')}</p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="press min-h-touch cursor-pointer rounded-sm border-2 border-ink bg-transparent px-5 font-type text-label font-bold text-ink hover:bg-[rgba(36,26,16,.08)]"
        >
          {t.t('ui.newGame.cancel')}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="press min-h-touch cursor-pointer rounded-sm border-2 border-[#6a1c1f] bg-[#6a1c1f] px-5 font-type text-label font-bold text-cream-2 hover:bg-[#7d2a2f]"
          data-testid="confirm-new-game-yes"
        >
          {t.t('ui.newGame.confirm')}
        </button>
      </div>
    </Sheet>
  );
}
