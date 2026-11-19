import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { canDecide, useGame } from '../store/game';
import type { RoomView } from '../worker/protocol';
import { optionName } from './names';

/** The ink left on the options while a decision is being sent. */
export type Stamp = 'approved' | 'rejected' | null;

/** How long the seal and the stamp take to come down before the decision is sent (ms). */
export const PRESS_MS = 650;

const reducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * The bottom rail of the Decision Room: what is happening (status line), the custom decision memo,
 * the request for more analysis, the REJECT ink stamp (runs the default option) and the wax seal
 * that approves the selected option. Every control sends an engine command or opens the memo.
 */
export function ActionBar({ v, stamp, setStamp }: { v: RoomView; stamp: Stamp; setStamp: (s: Stamp) => void }) {
  const t = useT();
  const room = useGame((s) => s.room);
  const decidable = useGame(canDecide);
  const busy = useGame((s) => s.busy !== null || s.advancePending);
  const approve = useGame((s) => s.approve);
  const reject = useGame((s) => s.reject);
  const requestAnalysis = useGame((s) => s.requestAnalysis);
  const openMemo = useGame((s) => s.openMemo);
  const [needOption, setNeedOption] = useState(false);
  const [pressing, setPressing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = room?.pending ?? null;
  const selected = room?.selected ?? null;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  // a refused decision (engine error) lifts the ink again: the room stays open
  const wasPending = useRef(pending);
  useEffect(() => {
    if (wasPending.current && !pending) {
      setStamp(null);
      setPressing(false);
    }
    wasPending.current = pending;
  }, [pending, setStamp]);
  useEffect(() => {
    if (selected) setNeedOption(false);
  }, [selected]);

  const acting = stamp !== null || pending !== null;
  /** Send after the press; if nothing was sent (the room could no longer decide), lift the ink. */
  const later = (fn: () => void) => {
    const send = () => {
      fn();
      if (!useGame.getState().room?.pending) {
        setStamp(null);
        setPressing(false);
      }
    };
    const ms = reducedMotion() ? 0 : PRESS_MS;
    if (ms === 0) return send();
    timer.current = setTimeout(send, ms);
  };

  const onSeal = () => {
    if (!decidable || acting) return;
    if (!selected) {
      setNeedOption(true);
      return;
    }
    setPressing(true);
    setStamp('approved');
    later(approve);
  };
  const onReject = () => {
    if (!decidable || acting) return;
    setStamp('rejected');
    later(reject);
  };

  const def = v.options.find((o) => o.id === v.defaultOptionId);
  let status: string;
  if (busy) status = t.t('ui.room.status.clock');
  else if (pending === 'analysis') status = t.t('ui.room.status.analysisSending');
  else if (stamp === 'approved' || pending === 'approve' || pending === 'custom') status = t.t('ui.room.status.sealing');
  else if (stamp === 'rejected' || pending === 'reject') status = t.t('ui.room.status.rejecting', { label: def ? t.t(def.labelKey) : '' });
  else if (needOption) status = t.t('ui.room.status.needOption');
  else if (selected) status = t.t('ui.room.status.selected', { option: optionName(t, v, selected) });
  else if (v.analysis && !v.analysis.ready) status = t.t('ui.room.status.analysisRequested', { day: v.analysis.readyDay });
  else status = t.t('ui.room.status.hint', { label: def ? t.t(def.labelKey) : '' });

  return (
    <div
      className="absolute left-0 top-[808px] z-30 box-border flex h-[92px] w-[1440px] items-center justify-between px-8"
      style={{ background: 'linear-gradient(180deg,#26130b,#140905)', borderTop: '3px solid #b8923c', boxShadow: '0 -10px 24px rgba(0,0,0,.6)' }}
      data-testid="action-bar"
    >
      <p className="m-0 max-w-[560px] font-type text-label leading-snug text-[#efe3c4]" role="status" aria-live="polite" data-testid="room-status">
        {status}
      </p>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={openMemo}
          disabled={!decidable || acting}
          className="press h-touch cursor-pointer rounded-[8px_8px_2px_2px] border-0 bg-[#e6d9b8] px-5 font-display text-[16px] font-bold text-[#2a1c10] shadow-[0_4px_10px_rgba(0,0,0,.5)] hover:bg-[#efe3c4] disabled:opacity-60"
          data-testid="open-memo"
        >
          {t.t('ui.room.action.custom')}
        </button>
        {v.analysis ? (
          <span className="flex h-touch items-center rounded-[8px_8px_2px_2px] border border-dashed border-[#b8923c] px-4 font-type text-label text-[#efe3c4]" data-testid="analysis-tab">
            {v.analysis.ready ? t.t('ui.room.analysis.ready') : t.t('ui.room.analysis.pending', { day: v.analysis.readyDay })}
          </span>
        ) : (
          <button
            type="button"
            onClick={requestAnalysis}
            disabled={!decidable || acting}
            className="press h-touch cursor-pointer rounded-[8px_8px_2px_2px] border-0 bg-[#e6d9b8] px-5 font-display text-[16px] font-bold text-[#2a1c10] shadow-[0_4px_10px_rgba(0,0,0,.5)] hover:bg-[#efe3c4] disabled:opacity-60"
            data-testid="request-analysis"
          >
            {t.t('ui.room.action.analysis')}
          </button>
        )}
        <button
          type="button"
          onClick={onReject}
          disabled={!decidable || acting}
          className="press h-touch cursor-pointer rounded border-[3px] border-double border-[#e2a98a] bg-transparent px-6 font-display text-[16px] font-extrabold uppercase tracking-[.14em] text-[#f1d3bf] hover:bg-[rgba(226,169,138,.08)] disabled:opacity-60"
          style={{ transform: 'rotate(-1deg)' }}
          aria-label={t.t('ui.room.action.reject.aria', { label: def ? t.t(def.labelKey) : '' })}
          data-testid="reject"
        >
          {t.t('ui.room.action.reject')}
        </button>
        <button
          type="button"
          onClick={onSeal}
          disabled={!decidable || acting}
          aria-label={selected ? t.t('ui.room.action.approve.aria', { option: optionName(t, v, selected) }) : t.t('ui.room.action.approve')}
          className={`seal flex h-[84px] w-[84px] cursor-pointer items-center justify-center border-0 p-0 disabled:cursor-not-allowed ${pressing ? 'seal-press' : ''}`}
          style={{
            borderRadius: '52% 48% 50% 50% / 50% 52% 48% 50%',
            background: 'radial-gradient(circle at 35% 28%,#c23a37,#7a1a1c 55%,#4a0b0e)',
            boxShadow: '0 8px 14px rgba(0,0,0,.6),inset 0 0 0 5px rgba(255,255,255,.1)',
            opacity: !decidable && !acting ? 0.6 : 1,
          }}
          data-testid="approve-seal"
        >
          <span
            className="flex h-[62px] w-[62px] items-center justify-center rounded-full font-display text-[15.5px] font-extrabold tracking-[.02em] text-[#f6e9cb]"
            style={{ boxShadow: 'inset 0 3px 6px rgba(0,0,0,.55),0 0 0 2px rgba(255,255,255,.14)' }}
          >
            {t.t('ui.room.action.approve')}
          </span>
        </button>
      </div>
    </div>
  );
}
