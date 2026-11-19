/**
 * previewCustomDecision: a custom memo's +7 / +30 impact is exactly what sealing it and advancing
 * gives, uses the options' baseline, is deterministic, and never touches the live state.
 */
import { describe, expect, it } from 'vitest';
import { STEEL_DECISION, day1State, engineAt } from '../test/seedFixture';
import { type CeoCommand, decisionImpacts, previewCustomDecision, selectDecision, snapshotKpis, stateHash } from './index';

const MEMO: CeoCommand[] = [
  { type: 'repriceOrders', materialId: 'steel', passThroughBps: 5000 },
  { type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 2000 },
];

describe('previewCustomDecision', () => {
  const s = day1State();
  const start = s.day;
  const preview = previewCustomDecision(s, STEEL_DECISION, MEMO);
  if (!preview) throw new Error('no preview on Day 1');

  it('has the Decision Room shape: +7 and +30 against the options’ baseline', () => {
    expect(preview.horizons).toEqual([7, 30]);
    expect(preview.impact.optionId).toBe('custom');
    expect(preview.impact.error).toBeNull();
    expect(preview.impact.horizons.map((h) => h.horizonDays)).toEqual([7, 30]);
    expect(preview.baseline).toEqual(selectDecision(s, STEEL_DECISION)?.impacts?.baseline);
    for (const h of preview.impact.horizons) expect(h.delta.cash).toBe(h.option.cash - h.baseline.cash);
  });

  it('equals sealing the memo and advancing 7 and 30 days', () => {
    const e = engineAt();
    const r = e.dispatch({ type: 'customDecision', decisionId: STEEL_DECISION, commands: MEMO });
    expect(r.ok).toBe(true);
    e.advance(7);
    expect(snapshotKpis(e.state(), start)).toEqual(preview.impact.horizons[0]?.option);
    e.advance(23);
    expect(snapshotKpis(e.state(), start)).toEqual(preview.impact.horizons[1]?.option);
  });

  it('a memo holding an option’s own instruction previews exactly that option', () => {
    const p = previewCustomDecision(s, STEEL_DECISION, [{ type: 'switchSupplier', materialId: 'steel', toSupplierId: 'sup_dogumetal' }]);
    const sw = decisionImpacts(s, STEEL_DECISION)?.options.find((o) => o.optionId === 'switch');
    expect(p?.impact.horizons).toEqual(sw?.horizons);
  });

  it('changes the outcome: the memo differs from the baseline', () => {
    const h30 = preview.impact.horizons[1]!;
    expect(h30.delta.grossMarginBps).not.toBe(0);
    expect(h30.delta.cash).not.toBe(0);
  });

  it('is deterministic and leaves the state and the caller’s list untouched', () => {
    const before = stateHash(s);
    const memo = JSON.parse(JSON.stringify(MEMO)) as CeoCommand[];
    const a = previewCustomDecision(s, STEEL_DECISION, memo);
    const b = previewCustomDecision(engineAt().state(), STEEL_DECISION, memo);
    expect(a).toEqual(b);
    expect(stateHash(s)).toBe(before);
    expect(memo).toEqual(MEMO);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('a memo the engine refuses comes back as a typed error, not a throw', () => {
    const tooMuch = previewCustomDecision(s, STEEL_DECISION, [{ type: 'grantDiscount', customerId: 'cus_velora', discountBps: 9000 }]);
    expect(tooMuch?.impact.error?.code).toBe('error.invalidRate');
    expect(tooMuch?.impact.horizons).toEqual([]);
    const empty = previewCustomDecision(s, STEEL_DECISION, []);
    expect(empty?.impact.error?.code).toBe('error.emptyCustomDecision');
    const notAllowed = previewCustomDecision(s, STEEL_DECISION, [
      { type: 'setSupplierPrice', supplierId: 'sup_kuzeycelik', materialId: 'steel', unitPrice: 1 } as unknown as CeoCommand,
    ]);
    expect(notAllowed?.impact.error?.code).toBe('error.commandNotAllowed');
  });

  it('is null for an unknown or closed decision', () => {
    expect(previewCustomDecision(s, 'dec-9999', MEMO)).toBeNull();
    const e = engineAt();
    e.dispatch({ type: 'rejectDecision', decisionId: STEEL_DECISION });
    expect(previewCustomDecision(e.state(), STEEL_DECISION, MEMO)).toBeNull();
  });
});
