import { useEffect, useRef, useState } from 'react';
import type { Telegram as TelegramView } from '@ceo-room/engine';
import { useT } from '../i18n';
import { useGame } from '../store/game';
import { decisionNumber, telegramNumber } from './figures';

const SEVERITY_COLOR = { high: '#8a1818', medium: '#7a4a00', low: '#2f4a3a' } as const;
const TILT = [-1.2, 0.9, -0.6, 0.5];

function Telegram({ tg, index, expanded, onToggle, isNew }: { tg: TelegramView; index: number; expanded: boolean; onToggle: () => void; isNew: boolean }) {
  const t = useT();
  const openDossier = useGame((s) => s.openDossier);
  const openOrderBook = useGame((s) => s.openOrderBook);
  const text = t.msg(tg.message);
  const read = tg.status === 'read';
  const panelId = `telegram-${tg.id}-details`;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    // keep the opened telegram in view inside the stack (scroll the stack only, never the scene)
    const el = ref.current;
    const box = el?.closest<HTMLElement>('.telegram-scroll');
    if (!expanded || !el || !box) return;
    const bottom = el.offsetTop + el.offsetHeight + 24 - box.clientHeight;
    if (bottom > box.scrollTop) box.scrollTop = bottom;
    if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop;
  }, [expanded]);
  return (
    <article
      ref={ref}
      className={`on-paper relative w-[340px] ${isNew ? 'telegram-in' : ''}`}
      style={{
        marginTop: index === 0 ? 0 : 6,
        transform: `rotate(${TILT[index % TILT.length]}deg)`,
        zIndex: expanded ? 50 : 40 - index,
        background: read ? '#ddcb9b' : '#e4d3a4',
        color: '#241a10',
        boxShadow: '0 10px 18px rgba(0,0,0,.5)',
      }}
      data-testid="telegram"
      data-code={tg.message.code}
      data-status={tg.status}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={expanded ? t.t('ui.telegram.collapse') : t.t('ui.telegram.expand', { text })}
        onClick={onToggle}
        className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left"
      >
        <span className="flex justify-between bg-[#2b1d14] px-3.5 py-[5px] font-type text-label tracking-[.12em] text-[#e9dcc0]">
          <span>{t.t('ui.telegram.form')}</span>
          <span>{t.t('ui.telegram.number', { n: telegramNumber(tg.id) })}</span>
        </span>
        <span className="block px-4 pb-3 pt-2.5">
          <span className={`block font-type text-label font-bold leading-[1.3] ${expanded ? '' : 'line-clamp-3'}`} data-testid="telegram-text">
            {text}
          </span>
          <span className="mt-2 flex items-center justify-between">
            <span
              className="inline-block border-2 px-2 py-0.5 font-type text-label font-bold tracking-[.1em]"
              style={{ borderColor: SEVERITY_COLOR[tg.severity], color: SEVERITY_COLOR[tg.severity], transform: 'rotate(-3deg)' }}
            >
              {t.t(`ui.telegram.severity.${tg.severity}`)}
            </span>
            {read && (
              <span className="font-type text-label font-bold tracking-[.14em] text-ink-muted" style={{ transform: 'rotate(2deg)' }} data-testid="telegram-read">
                {t.t('ui.telegram.readStamp')}
              </span>
            )}
          </span>
        </span>
      </button>
      {expanded && (
        <div id={panelId} className="border-t border-dashed border-[#8a7350] px-4 pb-3 pt-2 font-type text-label text-ink">
          <p className="m-0 text-ink-muted">{t.t('ui.telegram.received', { day: tg.day })}</p>
          {tg.decisionId ? (
            <>
              <p className="m-0 mt-1">{t.t('ui.telegram.decisionPending')}</p>
              <button
                type="button"
                onClick={() => openDossier(tg.decisionId!)}
                className="press mt-2 min-h-touch cursor-pointer rounded-sm border border-[#6a2428] bg-[#6a2428] px-3 font-type text-label font-bold text-cream-2 hover:bg-[#7d2a2f]"
              >
                {t.t('ui.telegram.openFolder', { n: decisionNumber(tg.decisionId) })}
              </button>
            </>
          ) : (
            read && <p className="m-0 mt-1">{t.t('ui.telegram.filed')}</p>
          )}
          {tg.orderId && (
            <button
              type="button"
              onClick={openOrderBook}
              className="press ml-0 mt-2 block min-h-touch cursor-pointer rounded-sm border border-[#2f4a3a] bg-[#2f4a3a] px-3 font-type text-label font-bold text-cream-2 hover:bg-[#3a5a47]"
            >
              {t.t('ui.telegram.openOrderBook')}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/** Telegram forms stacked at an angle, newest on top. Opening one marks it read. */
export function TelegramStack() {
  const t = useT();
  const telegrams = useGame((s) => s.report?.telegrams ?? null);
  const unread = useGame((s) => s.report?.developments.length ?? 0);
  const seen = useGame((s) => s.seenTelegrams);
  const markSeen = useGame((s) => s.markTelegramsSeen);
  const acknowledge = useGame((s) => s.acknowledge);
  const [expanded, setExpanded] = useState<string | null>(null);

  const ids = telegrams?.map((x) => x.id).join() ?? '';
  useEffect(() => {
    if (!telegrams) return;
    const fresh = telegrams.filter((x) => !seen[x.id]).map((x) => x.id);
    if (fresh.length === 0) return;
    const timer = setTimeout(() => markSeen(fresh), 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  if (!telegrams) return null;
  const list = [...telegrams].reverse();

  const toggle = (tg: TelegramView) => {
    if (expanded === tg.id) return setExpanded(null);
    setExpanded(tg.id);
    // reading a telegram that needs no decision files it as read (engine command)
    if (tg.status === 'new' && tg.decisionId === null) acknowledge(tg.id);
  };

  return (
    <section aria-labelledby="telegrams-heading">
      <div className="absolute left-[1019px] top-[96px] z-10 w-[200px]">
        <h2 id="telegrams-heading" className="m-0 font-display text-2xl font-medium italic leading-tight text-cream-2">
          {t.t('ui.telegrams.heading')}
        </h2>
        <div className="mt-1.5 font-type text-label leading-tight text-brass-text" data-testid="telegram-count">
          {t.t('ui.telegrams.count', { total: telegrams.length, unread })}
        </div>
      </div>
      <div
        className="telegram-scroll absolute left-[1005px] top-[272px] z-10 h-[372px] w-[384px] overflow-y-auto overflow-x-hidden px-3.5 pb-6 pt-3"
        data-testid="telegram-stack"
      >
        {list.length === 0 && <p className="m-0 font-hand text-xl font-semibold italic text-cream-2">{t.t('ui.telegrams.none')}</p>}
        {list.map((tg, i) => (
          <Telegram key={tg.id} tg={tg} index={i} expanded={expanded === tg.id} onToggle={() => toggle(tg)} isNew={!seen[tg.id]} />
        ))}
      </div>
    </section>
  );
}
