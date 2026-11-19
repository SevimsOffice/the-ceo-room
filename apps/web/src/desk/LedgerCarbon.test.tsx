// @vitest-environment jsdom
/**
 * The carbon copy of the ledger names records as the CEO knows them: a decision by its number, an
 * instruction by its name, an order or purchase order by its number and counterparty. No raw id
 * (dec-0001, cmd-0002, ord-0012, po-0003…) reaches the page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { type Command, createEngine } from '@ceo-room/engine';
import { createTranslator } from '@ceo-room/i18n';
import { loadSeed } from '@ceo-room/seed-data';
import { RNG_SEED, WORKSPACE_ID } from '../worker/handler';
import { buildDirectory } from '../worker/directory';
import { createLedgerTracker } from '../worker/room';
import { useGame } from '../store/game';
import { LedgerCarbon, lineText } from './LedgerCarbon';

const seed = loadSeed();
const RAW_ID = /\b(dec|cmd|ord|po|pay|rcv|dev)-\d+/;
/** every option id of every decision kind the engine opens, as a ledger line would quote it */
const OPTION_IDS = ['absorb', 'negotiate', 'switch', 'passOn', 'grant', 'refuse'];
const rawOption = (text: string): string | undefined => OPTION_IDS.find((id) => text.includes(`“${id}”`) || text.includes(`"${id}"`));

function slipAfter(cmd: Command) {
  const e = createEngine(seed, { rngSeed: RNG_SEED, workspaceId: WORKSPACE_ID });
  const r = e.dispatch(cmd);
  expect(r.ok).toBe(true);
  const slip = createLedgerTracker().update(e)!;
  return { slip, directory: buildDirectory(e.state()) };
}

const CASES: [string, Command][] = [
  ['an approved option', { type: 'approveOption', decisionId: 'dec-0001', optionId: 'negotiate' }],
  [
    'a custom memo (purchase order and repriced orders)',
    {
      type: 'customDecision',
      decisionId: 'dec-0001',
      commands: [
        { type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 2000 },
        { type: 'repriceOrders', materialId: 'steel', passThroughBps: 5000 },
      ],
    },
  ],
];

afterEach(() => cleanup());

describe('ledger carbon copy', () => {
  for (const [name, cmd] of CASES) {
    for (const locale of ['tr', 'en'] as const) {
      it(`${name} (${locale}): no raw dec-/cmd-/ord-/po- ids, records named by number and counterparty`, () => {
        const { slip, directory } = slipAfter(cmd);
        // the slip does carry ids: the page must translate every one of them
        expect(JSON.stringify(slip.lines)).toMatch(/dec-0001/);
        expect(JSON.stringify(slip.lines)).toMatch(/cmd-0001/);
        useGame.setState({ phase: 'ready', locale, directory, ledgerSlip: slip, ledgerOpen: true });
        render(<LedgerCarbon />);
        const text = screen.getByTestId('ledger-sheet').textContent!;
        expect(text).not.toMatch(RAW_ID);
        expect(rawOption(text)).toBeUndefined();
        expect(screen.getByTestId('ledger-slip').textContent).not.toMatch(RAW_ID);
        const t = createTranslator(locale, { directory });
        // the instruction by its name, the decision by its number
        expect(text).toContain(t.t('ui.ledger.line.commandAccepted', { type: t.t(`ui.command.${cmd.type}`) }));
        expect(text).toContain(t.t('ui.ledger.cause.command', { type: t.t(`ui.command.${cmd.type}`) }));
        expect(text).toContain(t.t('ui.ledger.ref.decision', { n: 1 }));
        // a purchase order line: number and the supplier (named in the line itself)
        const po = slip.lines.find((l) => l.code === 'ledger.PurchaseOrderPlaced');
        if (po) {
          expect(lineText(t, slip, po)).toContain(directory.suppliers[po.params.supplierId as string]!);
          expect(lineText(t, slip, po)).toContain(t.t('ui.ledger.ref.number', { n: String(Number(/(\d+)$/.exec(po.params.poId as string)![1])) }));
        }
        // a repriced order names its customer
        const repriced = slip.lines.find((l) => l.code === 'ledger.OrderRepriced');
        if (repriced) expect(lineText(t, slip, repriced)).toContain(directory.customers[repriced.params.customerId as string]!);
      });
    }
  }

  it('a default option that could not run is named by its label, never its id (tr, en)', () => {
    const { slip, directory } = slipAfter(CASES[0]![1]);
    expect(slip.options).toMatchObject({ absorb: 'option.supplierPrice.absorb', switch: 'option.supplierPrice.switch' });
    for (const locale of ['tr', 'en'] as const) {
      const t = createTranslator(locale, { directory });
      for (const optionId of Object.keys(slip.options)) {
        const line = { seq: 0, day: 8, code: 'ledger.DecisionDefaultFailed', params: { decisionId: 'dec-0001', optionId, reason: 'error.insufficientCash' }, cause: { kind: 'rule' as const, ruleId: 'rule.decision.deadline' } };
        const out = lineText(t, slip, line);
        expect(out).toContain(t.t(slip.options[optionId]!));
        expect(rawOption(out), out).toBeUndefined();
        expect(out).not.toMatch(RAW_ID);
      }
    }
  });

  it('supplier bills and deposits say which purchase order they belong to', () => {
    const { slip, directory } = slipAfter(CASES[1]![1]);
    const poId = Object.keys(slip.parties).find((k) => slip.parties[k]!.kind === 'supplier')!;
    const params = { poId, payableId: 'pay-0007', amount: 100_000, dueDay: 30, supplierId: 'sup_kuzeycelik' };
    const line = (code: string) => ({ seq: 0, day: 1, code, params, cause: { kind: 'rule' as const, ruleId: 'x' } });
    const en = createTranslator('en', { directory });
    const tr = createTranslator('tr', { directory });
    for (const code of ['ledger.PayableCreated', 'ledger.PayableCancelled', 'ledger.DepositForfeited']) {
      expect(lineText(en, slip, line(code))).toContain('purchase order No. ');
      expect(lineText(tr, slip, line(code))).toMatch(/No\. \d+.* satın alma siparişi/);
      expect(lineText(en, slip, line(code))).not.toMatch(RAW_ID);
    }
  });

  it('an order without its customer on the line is named by the customer the slip knows', () => {
    const { slip, directory } = slipAfter(CASES[1]![1]);
    const t = createTranslator('en', { directory });
    const orderId = Object.keys(slip.parties).find((k) => slip.parties[k]!.kind === 'customer')!;
    expect(orderId).toBeDefined();
    const party = slip.parties[orderId]!;
    const line = { seq: 0, day: 1, code: 'ledger.OrderRecosted', params: { orderId, costEstimate: 100, previous: 90 }, cause: { kind: 'rule' as const, ruleId: 'x' } };
    const out = lineText(t, slip, line);
    expect(out).toContain(directory.customers[party.id]!);
    expect(out).not.toMatch(RAW_ID);
  });
});
