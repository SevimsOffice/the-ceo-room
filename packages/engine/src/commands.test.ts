/**
 * Command validation: invalid commands return a typed error (i18n code + params) and change nothing:
 * not the state, not the ledger, not the save-game log.
 */
import { describe, expect, it } from 'vitest';
import { STEEL_DECISION, engineAt } from '../test/seedFixture';
import { type Command, CUSTOM_ALLOWED, type Engine, stateHash, tl } from './index';

function expectRejected(e: Engine, cmd: Command, code: string): void {
  const h = stateHash(e.state());
  const json = JSON.stringify(e.state());
  const ledgerLen = e.ledger().length;
  const log = JSON.stringify(e.snapshot().log);
  const r = e.dispatch(cmd);
  expect(r.ok, `${cmd.type} should be rejected`).toBe(false);
  if (r.ok) return;
  expect(r.error.code).toBe(code);
  expect(typeof r.error.params).toBe('object');
  expect(stateHash(e.state())).toBe(h);
  expect(JSON.stringify(e.state())).toBe(json);
  expect(e.ledger().length).toBe(ledgerLen);
  expect(JSON.stringify(e.snapshot().log)).toBe(log);
}

const approve = (optionId: string, decisionId = STEEL_DECISION): Command => ({ type: 'approveOption', decisionId, optionId });

describe('decision commands', () => {
  it('approving a non-existent option or decision', () => {
    const e = engineAt();
    expectRejected(e, approve('nope'), 'error.unknownOption');
    expectRejected(e, approve('absorb', 'dec-9999'), 'error.unknownDecision');
    expectRejected(e, { type: 'rejectDecision', decisionId: 'dec-9999' }, 'error.unknownDecision');
    expectRejected(e, { type: 'requestAnalysis', decisionId: 'dec-9999' }, 'error.unknownDecision');
  });

  it('approving twice, or acting on a decision already decided', () => {
    const e = engineAt();
    expect(e.dispatch(approve('negotiate')).ok).toBe(true);
    expectRejected(e, approve('negotiate'), 'error.decisionClosed');
    expectRejected(e, approve('switch'), 'error.decisionClosed');
    expectRejected(e, { type: 'rejectDecision', decisionId: STEEL_DECISION }, 'error.decisionClosed');
    expectRejected(e, { type: 'requestAnalysis', decisionId: STEEL_DECISION }, 'error.decisionClosed');
    expectRejected(
      e,
      { type: 'customDecision', decisionId: STEEL_DECISION, commands: [{ type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 1000 }] },
      'error.decisionClosed',
    );
  });

  it('approving a decision closed by its deadline', () => {
    const e = engineAt();
    e.advance(7);
    expect(e.state().decisions.find((d) => d.id === STEEL_DECISION)?.status).toBe('expired');
    const r = e.dispatch(approve('switch'));
    expect(r.ok ? null : r.error).toEqual({ code: 'error.decisionClosed', params: { decisionId: STEEL_DECISION, status: 'expired' } });
    expectRejected(e, approve('switch'), 'error.decisionClosed');
  });

  it('requesting analysis twice', () => {
    const e = engineAt();
    expect(e.dispatch({ type: 'requestAnalysis', decisionId: STEEL_DECISION }).ok).toBe(true);
    expectRejected(e, { type: 'requestAnalysis', decisionId: STEEL_DECISION }, 'error.analysisAlreadyRequested');
  });
});

describe('custom decisions and operational commands', () => {
  it('rejects command types not on the allow-list, inside a custom decision or on their own', () => {
    const e = engineAt();
    expect(CUSTOM_ALLOWED).not.toContain('customerReaction');
    const reaction: Command = { type: 'customerReaction', customerId: 'cus_demirhan', satisfactionDelta: 1000, churnRiskDelta: -1000, reasonCode: 'reason.test' };
    expectRejected(e, { type: 'customDecision', decisionId: STEEL_DECISION, commands: [reaction] }, 'error.commandNotAllowed');
    expectRejected(
      e,
      {
        type: 'customDecision',
        decisionId: STEEL_DECISION,
        commands: [{ type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 1000 }, reaction],
      },
      'error.commandNotAllowed',
    );
    expectRejected(e, reaction, 'error.commandNotAllowed');
    expectRejected(e, { type: 'customDecision', decisionId: STEEL_DECISION, commands: [{ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'switch' }] } as unknown as Command, 'error.commandNotAllowed');
    expectRejected(e, { type: 'customDecision', decisionId: STEEL_DECISION, commands: [] }, 'error.emptyCustomDecision');
    expectRejected(e, { type: 'launchRocket' } as unknown as Command, 'error.commandNotAllowed');
  });

  it('validates operational parameters (ids, integer money, ranges)', () => {
    const e = engineAt();
    const cases: [Command, string][] = [
      [{ type: 'setSupplierPrice', supplierId: 'sup_nobody', materialId: 'steel', unitPrice: tl(40) }, 'error.unknownSupplier'],
      [{ type: 'setSupplierPrice', supplierId: 'sup_kuzeycelik', materialId: 'aluminium', unitPrice: tl(40) }, 'error.noOffer'],
      [{ type: 'setSupplierPrice', supplierId: 'sup_kuzeycelik', materialId: 'steel', unitPrice: 40.5 as never }, 'error.invalidAmount'],
      [{ type: 'setSupplierPrice', supplierId: 'sup_kuzeycelik', materialId: 'steel', unitPrice: 0 as never }, 'error.invalidAmount'],
      [{ type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 0 }, 'error.invalidAmount'],
      [{ type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 1.5 }, 'error.invalidAmount'],
      [{ type: 'switchSupplier', materialId: 'steel', toSupplierId: 'sup_kuzeycelik' }, 'error.alreadyPreferred'],
      [{ type: 'switchSupplier', materialId: 'unobtainium', toSupplierId: 'sup_dogumetal' }, 'error.unknownMaterial'],
      [{ type: 'switchSupplier', materialId: 'steel', toSupplierId: 'sup_alpaka' }, 'error.noOffer'],
      [{ type: 'grantDiscount', customerId: 'cus_nobody', discountBps: 500, satisfactionDelta: 0, churnRiskDelta: 0 }, 'error.unknownCustomer'],
      [{ type: 'grantDiscount', customerId: 'cus_velora', discountBps: 6000, satisfactionDelta: 0, churnRiskDelta: 0 }, 'error.invalidRate'],
      [{ type: 'grantDiscount', customerId: 'cus_velora', discountBps: -1, satisfactionDelta: 0, churnRiskDelta: 0 }, 'error.invalidRate'],
      [
        { type: 'repriceOrders', materialId: 'steel', unitCostIncrease: tl(1), passThroughBps: 10001, reaction: { satisfactionDelta: 0, churnRiskDelta: 0, paymentDelayDays: 0 } },
        'error.invalidRate',
      ],
    ];
    for (const [cmd, code] of cases) expectRejected(e, cmd, code);
    // the same checks guard custom decisions
    for (const [cmd, code] of cases) expectRejected(e, { type: 'customDecision', decisionId: STEEL_DECISION, commands: [cmd as never] }, code);
    expect(e.state().decisions.find((d) => d.id === STEEL_DECISION)?.status).toBe('open');
  });

  it('a valid custom decision with allowed commands resolves the decision', () => {
    const e = engineAt();
    const r = e.dispatch({
      type: 'customDecision',
      decisionId: STEEL_DECISION,
      commands: [{ type: 'setSupplierPrice', supplierId: 'sup_kuzeycelik', materialId: 'steel', unitPrice: tl(43) }],
    });
    expect(r.ok).toBe(true);
    const d = e.state().decisions.find((x) => x.id === STEEL_DECISION);
    expect(d?.status).toBe('approved');
    expect(d?.chosenOptionId).toBeNull();
    expect(d?.custom).toHaveLength(1);
    expect(e.state().suppliers.find((s) => s.id === 'sup_kuzeycelik')?.offers[0]?.unitPrice).toBe(tl(43));
  });
});

describe('desk commands', () => {
  it('acknowledging unknown, already-read, or decision-bearing telegrams', () => {
    const e = engineAt();
    expectRejected(e, { type: 'acknowledgeDevelopment', developmentId: 'dev-9999' }, 'error.unknownDevelopment');
    expectRejected(e, { type: 'acknowledgeDevelopment', developmentId: 'dev-0002' }, 'error.developmentHasOpenDecision');
    expect(e.dispatch({ type: 'acknowledgeDevelopment', developmentId: 'dev-0001' }).ok).toBe(true);
    expectRejected(e, { type: 'acknowledgeDevelopment', developmentId: 'dev-0001' }, 'error.developmentNotNew');
    expect(e.dispatch(approve('absorb')).ok).toBe(true);
    expectRejected(e, { type: 'acknowledgeDevelopment', developmentId: 'dev-0002' }, 'error.developmentNotNew');
  });
});
