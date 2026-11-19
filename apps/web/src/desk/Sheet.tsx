import { type ReactNode, useEffect, useRef } from 'react';
import { useT } from '../i18n';
import { PaperNoise } from './Atmosphere';

/**
 * A sheet of paper laid over the desk (modal): focus moves in, Tab stays inside, Escape or the
 * close button puts it away and focus returns to what opened it, or, when that is gone (a sheet
 * that opened by itself, e.g. the carbon copy after the Decision Room closed), to `returnFocus`.
 */
export function Sheet({
  title,
  onClose,
  children,
  width = 820,
  testId,
  role = 'dialog',
  returnFocus,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  testId?: string;
  role?: 'dialog' | 'alertdialog';
  returnFocus?: () => HTMLElement | null;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]');
    if (first) first.focus();
    else el?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && opener !== document.body && opener.isConnected) opener.focus?.();
      else returnRef.current?.()?.focus();
    };
  }, []);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center" style={{ background: 'rgba(10,4,2,.62)' }} onClick={onClose}>
      <div
        ref={ref}
        role={role}
        aria-modal="true"
        aria-labelledby="sheet-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="paper on-paper sheet-in relative max-h-[800px] overflow-y-auto px-11 pb-8 pt-9"
        style={{ width, transform: 'rotate(-.4deg)', boxShadow: '0 2px 3px rgba(0,0,0,.4),0 30px 60px rgba(0,0,0,.75)' }}
        data-testid={testId}
      >
        <PaperNoise id={`paper-sheet-${testId ?? 'x'}`} opacity={0.3} />
        <div className="relative">
          <div className="flex items-start justify-between gap-6">
            <h2 id="sheet-title" className="m-0 font-display text-[30px] font-extrabold leading-tight">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              data-autofocus
              className="press min-h-touch shrink-0 cursor-pointer rounded-sm border-2 border-ink bg-transparent px-4 font-type text-label font-bold uppercase tracking-[.12em] text-ink hover:bg-[rgba(36,26,16,.08)]"
            >
              {t.t('ui.sheet.close')}
            </button>
          </div>
          <div className="mt-3 h-1.5 border-b border-t-[3px] border-ink" />
          {children}
        </div>
      </div>
    </div>
  );
}
