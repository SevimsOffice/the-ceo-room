import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { canDecide, currentMemoPreview, useGame } from '../store/game';
import type { MemoCatalog, RoomView } from '../worker/protocol';
import { Sheet } from '../desk/Sheet';
import { ImpactTable } from './ImpactTable';
import {
  MEMO_MAX_LINES,
  type MemoKind,
  type MemoLine,
  answersDemand,
  availableKinds,
  memoCommands,
  newLine,
  offeredMaterials,
  offeringSuppliers,
  sameMemo,
  switchTargets,
} from './memo';

const field = 'min-h-touch box-border rounded-sm border-2 border-[#6b5a40] bg-[#f5ecd6] px-2 font-type text-label text-ink';
const labelCls = 'flex flex-col gap-1 font-type text-label text-ink-muted';

/** A line whose number has not been typed yet shows no error (the preview note asks for it). */
const untouched = (l: MemoLine): boolean => ('qty' in l ? l.qty : 'percent' in l ? l.percent : 'x').trim() === '';

function LineFields({ line, c, index, onChange }: { line: MemoLine; c: MemoCatalog; index: number; onChange: (l: MemoLine) => void }) {
  const t = useT();
  const id = (k: string) => `memo-${index}-${k}`;
  const material = (m: string) => t.t('ui.room.memo.materialName', { materialId: m });
  const supplier = (sup: string) => t.t('ui.room.memo.supplierName', { supplierId: sup });
  switch (line.kind) {
    case 'placePurchaseOrder': {
      const mats = offeredMaterials(c, line.supplierId);
      return (
        <>
          <label className={labelCls} htmlFor={id('supplier')}>
            {t.t('ui.room.memo.field.supplier')}
            <select
              id={id('supplier')}
              className={field}
              value={line.supplierId}
              onChange={(e) => {
                const sup = e.target.value;
                const m = offeredMaterials(c, sup);
                onChange({ ...line, supplierId: sup, materialId: m.includes(line.materialId) ? line.materialId : (m[0] ?? '') });
              }}
            >
              {offeringSuppliers(c).map((s) => (
                <option key={s} value={s}>
                  {supplier(s)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls} htmlFor={id('material')}>
            {t.t('ui.room.memo.field.material')}
            <select id={id('material')} className={field} value={line.materialId} onChange={(e) => onChange({ ...line, materialId: e.target.value })}>
              {mats.map((m) => (
                <option key={m} value={m}>
                  {material(m)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls} htmlFor={id('qty')}>
            {t.t('ui.room.memo.field.qty')}
            <input id={id('qty')} className={`${field} w-[150px]`} inputMode="numeric" value={line.qty} onChange={(e) => onChange({ ...line, qty: e.target.value })} data-testid="memo-qty" />
          </label>
        </>
      );
    }
    case 'switchSupplier': {
      const mats = c.materials.filter((m) => switchTargets(c, m.id).length > 0).map((m) => m.id);
      return (
        <>
          <label className={labelCls} htmlFor={id('material')}>
            {t.t('ui.room.memo.field.material')}
            <select
              id={id('material')}
              className={field}
              value={line.materialId}
              onChange={(e) => onChange({ ...line, materialId: e.target.value, toSupplierId: switchTargets(c, e.target.value)[0] ?? '' })}
            >
              {mats.map((m) => (
                <option key={m} value={m}>
                  {material(m)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls} htmlFor={id('to')}>
            {t.t('ui.room.memo.field.toSupplier')}
            <select id={id('to')} className={field} value={line.toSupplierId} onChange={(e) => onChange({ ...line, toSupplierId: e.target.value })}>
              {switchTargets(c, line.materialId).map((s) => (
                <option key={s} value={s}>
                  {supplier(s)}
                </option>
              ))}
            </select>
          </label>
        </>
      );
    }
    case 'repriceOrders':
      return (
        <>
          <p className="m-0 self-center font-type text-label text-ink">{t.t('ui.room.memo.repriceOf', { materialId: line.materialId })}</p>
          <label className={labelCls} htmlFor={id('pct')}>
            {t.t('ui.room.memo.field.passThrough')}
            <input id={id('pct')} className={`${field} w-[130px]`} inputMode="decimal" value={line.percent} onChange={(e) => onChange({ ...line, percent: e.target.value })} data-testid="memo-pass" />
          </label>
        </>
      );
    case 'grantDiscount':
      return (
        <>
          <label className={labelCls} htmlFor={id('customer')}>
            {t.t('ui.room.memo.field.customer')}
            <select id={id('customer')} className={`${field} max-w-[330px]`} value={line.customerId} onChange={(e) => onChange({ ...line, customerId: e.target.value })}>
              {c.customers.map((x) => (
                <option key={x.id} value={x.id}>
                  {t.t('ui.room.memo.customerName', { customerId: x.id })}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls} htmlFor={id('pct')}>
            {t.t('ui.room.memo.field.discount')}
            <input id={id('pct')} className={`${field} w-[130px]`} inputMode="decimal" value={line.percent} onChange={(e) => onChange({ ...line, percent: e.target.value })} data-testid="memo-discount" />
          </label>
        </>
      );
  }
}

/**
 * The custom decision memo: typed lines composing the engine's allow-listed instructions, checked
 * against the engine's limits, previewed at +7 / +30 by the engine (previewCustomDecision in the
 * worker) and sealed exactly as previewed.
 */
export function MemoSheet({ v }: { v: RoomView }) {
  const t = useT();
  const c = v.memo!;
  const close = useGame((s) => s.closeMemo);
  const previewMemo = useGame((s) => s.previewMemo);
  const sealMemo = useGame((s) => s.sealMemo);
  const memo = useGame((s) => s.room?.memo ?? null);
  const current = useGame(currentMemoPreview);
  const decidable = useGame(canDecide);
  const busy = useGame((s) => s.busy !== null || s.advancePending);
  const pending = useGame((s) => s.room?.pending ?? null);
  const kinds = availableKinds(c);
  const [lines, setLines] = useState<MemoLine[]>(() => [newLine(c.demand ? 'grantDiscount' : kinds[0]!, c)]);
  const [addKind, setAddKind] = useState<MemoKind>(kinds[0]!);
  const [pressing, setPressing] = useState(false);
  const checked = useMemo(() => memoCommands(lines, c), [lines, c]);
  // a refused seal (engine error) lifts the seal again
  useEffect(() => {
    if (pending === null) setPressing(false);
  }, [pending]);

  const previewed = memo !== null && sameMemo(checked.commands, memo.commands);
  const ready = previewed && current !== null && current.status === 'ready' && current.preview !== null;
  const engineError = ready ? (current.preview!.impact.error ?? null) : null;
  const canSeal = ready && !engineError && decidable && pending === null;

  let previewNote: string | null = null;
  if (!checked.commands) previewNote = t.t('ui.room.memo.fixFirst');
  else if (!memo || !previewed) previewNote = t.t('ui.room.memo.previewFirst');
  else if (memo.status === 'waiting') previewNote = t.t('ui.room.memo.previewing');
  else if (memo.version !== current?.version || !current) previewNote = t.t('ui.room.memo.stale');
  else if (current.status === 'busy') previewNote = t.t('ui.room.status.clock');
  else if (current.status === 'closed') previewNote = t.t('ui.room.memo.closed');

  const update = (i: number, l: MemoLine) => setLines((ls) => ls.map((x, j) => (j === i ? l : x)));

  return (
    <Sheet title={t.t('ui.room.memo.title', { n: v.number })} onClose={close} width={1000} testId="memo">
      <div className="font-type text-label text-ink">
        <p className="m-0 mt-3 font-hand text-[20px] font-semibold italic leading-snug" style={{ color: '#5a2a14' }}>
          {t.t('ui.room.memo.intro')}
        </p>
        <ol className="m-0 mt-3 list-none p-0" data-testid="memo-lines">
          {lines.map((l, i) => (
            <li key={i} className="report-row py-2" data-testid="memo-line">
              <div className="flex flex-wrap items-end gap-3">
                <span className="self-center font-display text-lg font-bold">{i + 1}.</span>
                <span className="self-center font-type text-label font-bold">{t.t(`ui.room.memo.kind.${l.kind}`)}</span>
                <LineFields line={l} c={c} index={i} onChange={(x) => update(i, x)} />
                <button
                  type="button"
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  className="press ml-auto min-h-touch min-w-touch cursor-pointer rounded-sm border-2 border-ink bg-transparent px-3 font-type text-label font-bold text-ink hover:bg-[rgba(36,26,16,.08)]"
                  aria-label={t.t('ui.room.memo.remove.aria', { n: i + 1 })}
                >
                  {t.t('ui.room.memo.remove')}
                </button>
              </div>
              {checked.errors[i] && !untouched(l) && (
                <p className="m-0 mt-1 text-oxblood-ink" role="alert" data-testid="memo-error">
                  {t.t(checked.errors[i]!.key, checked.errors[i]!.params)}
                </p>
              )}
            </li>
          ))}
        </ol>
        {lines.length < MEMO_MAX_LINES && (
          <div className="mt-3 flex items-end gap-3">
            <label className={labelCls} htmlFor="memo-add-kind">
              {t.t('ui.room.memo.addKind')}
              <select id="memo-add-kind" className={field} value={addKind} onChange={(e) => setAddKind(e.target.value as MemoKind)} data-testid="memo-add-kind">
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {t.t(`ui.room.memo.kind.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setLines((ls) => [...ls, newLine(addKind, c)])}
              className="press min-h-touch cursor-pointer rounded-sm border-2 border-ink bg-transparent px-4 font-type text-label font-bold text-ink hover:bg-[rgba(36,26,16,.08)]"
              data-testid="memo-add"
            >
              {t.t('ui.room.memo.add')}
            </button>
          </div>
        )}
        {checked.commands && !answersDemand(checked.commands, c) && (
          <p className="m-0 mt-2 text-oxblood-ink" data-testid="memo-refusal">
            {t.t('ui.room.memo.refusal', { customerId: c.demand!.customerId })}
          </p>
        )}

        <div className="mt-4 flex items-start gap-6">
          <div className="w-[420px] flex-none">
            <h3 className="m-0 font-display text-lg font-bold">{t.t('ui.room.memo.preview')}</h3>
            <div className="mt-2" aria-live="polite" data-testid="memo-preview">
              {previewNote && <p className="m-0 text-ink-muted">{previewNote}</p>}
              {!previewNote && engineError && (
                <p className="m-0 text-oxblood-ink" data-testid="memo-engine-error">
                  {t.t('ui.status.commandFailed', { reason: t.msg(engineError) })}
                </p>
              )}
              {!previewNote && ready && !engineError && <ImpactTable horizons={current!.preview!.impact.horizons} today={v.day} testId="memo-impact" />}
            </div>
          </div>
          <div className="flex flex-1 flex-col items-end gap-4">
            <button
              type="button"
              onClick={() => checked.commands && previewMemo(checked.commands)}
              disabled={!checked.commands || busy || (previewed && memo?.status === 'waiting')}
              className="press min-h-touch cursor-pointer rounded-sm border-2 border-bottle bg-bottle px-5 font-display text-lg font-bold text-cream-2 hover:bg-[#3a5a47] disabled:opacity-60"
              data-testid="memo-preview-button"
            >
              {t.t('ui.room.memo.previewButton')}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!canSeal) return;
                setPressing(true);
                sealMemo();
              }}
              disabled={!canSeal}
              aria-label={t.t('ui.room.memo.seal.aria')}
              className={`flex h-[96px] w-[96px] cursor-pointer items-center justify-center border-0 p-0 disabled:cursor-not-allowed disabled:opacity-50 ${pressing ? 'seal-press' : ''}`}
              style={{
                borderRadius: '52% 48% 50% 50% / 50% 52% 48% 50%',
                background: 'radial-gradient(circle at 35% 28%,#c23a37,#7a1a1c 55%,#4a0b0e)',
                boxShadow: '0 8px 14px rgba(0,0,0,.6),inset 0 0 0 5px rgba(255,255,255,.1)',
              }}
              data-testid="memo-seal"
            >
              <span className="flex h-[70px] w-[70px] items-center justify-center rounded-full font-display text-[15.5px] font-extrabold text-[#f6e9cb]" style={{ boxShadow: 'inset 0 3px 6px rgba(0,0,0,.55),0 0 0 2px rgba(255,255,255,.14)' }}>
                {t.t('ui.room.memo.seal')}
              </span>
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
