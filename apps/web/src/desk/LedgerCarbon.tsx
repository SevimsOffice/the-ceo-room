import { useRef } from 'react';
import type { Translator } from '@ceo-room/i18n';
import { useT } from '../i18n';
import { useGame } from '../store/game';
import type { LedgerCause, LedgerLine, LedgerParty, LedgerSlip } from '../worker/protocol';
import { Sheet } from './Sheet';
import { decisionNumber } from './figures';

/** The number at the end of a record id ("ord-0012" → "12"); the id itself when it has none. */
export function refNumber(id: string): string {
  const m = /(\d+)$/.exec(id);
  return m ? String(Number(m[1])) : id;
}

const partyName = (t: Translator, p: LedgerParty): string =>
  p.kind === 'customer' ? t.t('ui.room.memo.customerName', { customerId: p.id }) : t.t('ui.room.memo.supplierName', { supplierId: p.id });

/** Why a line happened, in words: the CEO's instruction, an earlier line, or an engine rule. */
export function causeText(t: Translator, c: LedgerCause): string {
  switch (c.kind) {
    case 'command':
      return t.t('ui.ledger.cause.command', { type: t.t(`ui.command.${c.commandType}`) });
    case 'event':
      return t.t('ui.ledger.cause.event', { seq: c.seq });
    case 'rule':
      return c.ruleId === 'rule.decision.deadline' ? t.t('ui.ledger.cause.deadline') : t.t('ui.ledger.cause.rule', { rule: c.ruleId });
  }
}

/** Record ids printed as their number only (telegrams, bills, invoices, recurring costs). */
const NUMBERED = ['developmentId', 'payableId', 'receivableId', 'costId'] as const;

/**
 * A ledger line in words. No raw record id is printed: a decision reads as its number, the CEO's
 * instruction by its name, an order or purchase order by its number and counterparty; the
 * decision's status, option and command names are translated.
 */
export function lineText(t: Translator, slip: LedgerSlip, l: LedgerLine): string {
  const params: Record<string, string | number | boolean | null> = { ...l.params };
  if (l.code === 'ledger.CommandAccepted') {
    const type = typeof params.commandType === 'string' ? t.t(`ui.command.${params.commandType}`) : '';
    return t.t('ui.ledger.line.commandAccepted', { type });
  }
  if (l.code === 'ledger.DecisionResolved') {
    if (typeof params.status === 'string') params.status = t.t(`ui.decision.status.${params.status}`);
    if (params.optionId === 'custom') params.optionId = t.t('ui.ledger.customOption');
    else if (slip.optionLabelKey && params.optionId === slip.optionId) params.optionId = t.t(slip.optionLabelKey);
  }
  if (typeof params.decisionId === 'string') params.decisionId = t.t('ui.ledger.ref.decision', { n: decisionNumber(params.decisionId) });
  for (const k of ['orderId', 'poId'] as const) {
    const id = params[k];
    if (typeof id !== 'string') continue;
    const party = slip.parties[id];
    // the line names the counterparty itself: the number is enough
    const named = party !== undefined && (params.customerId === party.id || params.supplierId === party.id);
    params[k] = party && !named ? t.t('ui.ledger.ref.party', { n: refNumber(id), party: partyName(t, party) }) : t.t('ui.ledger.ref.number', { n: refNumber(id) });
  }
  for (const k of NUMBERED) {
    const id = params[k];
    if (typeof id === 'string') params[k] = t.t('ui.ledger.ref.number', { n: refNumber(id) });
  }
  return t.t(l.code, params);
}

/** The slip's heading: which decision, how it closed, which option. */
export function slipTitle(t: Translator, slip: LedgerSlip): string {
  const status = t.t(`ui.decision.status.${slip.status}`);
  const n = decisionNumber(slip.decisionId);
  if (slip.custom) return t.t('ui.ledger.title.custom', { n, status });
  if (slip.optionLabelKey) return t.t('ui.ledger.title.option', { n, status, label: t.t(slip.optionLabelKey) });
  return t.t('ui.ledger.title.none', { n, status });
}

/**
 * The carbon copy of the ledger for the latest decision: a brass-edged slip on the Desk that opens
 * the copy (it opens by itself right after a decision is taken in the Decision Room).
 */
export function LedgerCarbon() {
  const t = useT();
  const slip = useGame((s) => s.ledgerSlip);
  const open = useGame((s) => s.ledgerOpen);
  const openLedger = useGame((s) => s.openLedger);
  const close = useGame((s) => s.closeLedger);
  const slipButton = useRef<HTMLButtonElement>(null);
  if (!slip) return null;
  return (
    <>
      <button
        ref={slipButton}
        type="button"
        onClick={openLedger}
        className="press on-paper absolute bottom-[26px] left-[61px] z-10 box-border flex min-h-touch w-[290px] cursor-pointer flex-col items-start justify-center border-0 px-4 py-1.5 text-left"
        style={{ background: 'linear-gradient(180deg,#e6dcc0,#d8ccab)', color: '#2c2547', transform: 'rotate(-1deg)', boxShadow: '0 8px 16px rgba(0,0,0,.5)' }}
        data-testid="ledger-slip"
        data-decision={slip.decisionId}
      >
        <span className="font-type text-label font-bold uppercase tracking-[.12em]">{t.t('ui.ledger.carbon')}</span>
        <span className="font-type text-label leading-tight" data-testid="ledger-slip-title">
          {slipTitle(t, slip)}
        </span>
      </button>
      {open && (
        <Sheet title={t.t('ui.ledger.heading')} onClose={close} width={860} testId="ledger-sheet" returnFocus={() => slipButton.current}>
          <p className="m-0 mt-3 font-display text-lg font-bold" data-testid="ledger-sheet-title">
            {slipTitle(t, slip)}
          </p>
          <p className="m-0 mt-1 font-type text-label text-ink-muted">{t.t('ui.ledger.sub', { day: slip.day })}</p>
          <ol className="m-0 mt-3 list-none p-0 font-type text-label text-ink" data-testid="ledger-lines">
            {slip.lines.map((l) => (
              <li key={l.seq} className="report-row flex gap-3 py-1.5" data-testid="ledger-line" data-code={l.code}>
                <span className="w-[92px] flex-none font-bold text-ink-muted">{t.t('ui.ledger.seq', { seq: l.seq })}</span>
                <span className="flex-1">
                  <span className="block">{lineText(t, slip, l)}</span>
                  <span className="block italic text-ink-muted" data-testid="ledger-cause">
                    {causeText(t, l.cause)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          {slip.more > 0 && <p className="m-0 mt-2 font-type text-label text-ink-muted">{t.plural('ui.ledger.more', slip.more)}</p>}
        </Sheet>
      )}
    </>
  );
}
