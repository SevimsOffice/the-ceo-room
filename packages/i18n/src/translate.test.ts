import { describe, expect, it } from 'vitest';
import { createTranslator, placeholders, type Directory } from './translate';

const directory: Directory = {
  customers: { cus_a: 'Demirhan Raylı Sistemler A.Ş.' },
  suppliers: { sup_k: 'Kuzeyçelik Haddecilik A.Ş.' },
  plants: { plant_g: 'Gemlik' },
  materials: { steel: 'material.steel' },
  families: { frames: 'product.frames' },
  lines: { p2_press: { kindKey: 'line.press', plantId: 'plant_g' } },
};

describe('translator', () => {
  it('interpolates params with formats and the directory', () => {
    const tr = createTranslator('tr', { directory });
    expect(tr.t('card.supplierPriceIncrease', { supplierId: 'sup_k', materialId: 'steel', changeBps: 2000 })).toBe(
      'Kuzeyçelik Haddecilik A.Ş., çelik fiyatını %20 artırıyor.',
    );
    const en = createTranslator('en', { directory });
    expect(en.t('card.machineBreakdown', { lineId: 'p2_press', repairDays: 5 })).toBe('The Gemlik press line has broken down. Repair will take 5 days.');
    expect(en.t('card.largeOrder', { customerId: 'cus_a', familyId: 'frames', qty: 920, value: 2_208_000_000, requestedDay: 46, paymentTermsDays: 90 })).toBe(
      'Large order from Demirhan Raylı Sistemler A.Ş.: 920 machine frames, 22.1M TL, wanted by Day 46, paid 90 days after delivery.',
    );
  });

  it('nested codes, weekdays and plurals', () => {
    const en = createTranslator('en');
    expect(en.t('ledger.DecisionDefaultFailed', { decisionId: 'dec-1', optionId: 'absorb', reason: 'error.invalidCommand' })).toContain(
      '(That instruction is not understood.)',
    );
    expect(en.plural('ui.decision.daysLeft', 1)).toBe('1 day left to decide');
    expect(en.plural('ui.decision.daysLeft', 4)).toBe('4 days left to decide');
    expect(createTranslator('tr').plural('ui.decision.daysLeft', 4)).toBe('Karar için 4 gün kaldı');
  });

  it('unknown codes come back as the code and are reported', () => {
    const seen: string[] = [];
    const en = createTranslator('en', { onMissing: (c) => seen.push(c) });
    expect(en.t('nope.missing')).toBe('nope.missing');
    expect(seen).toEqual(['nope.missing']);
  });

  it('unknown ids fall back to the id', () => {
    expect(createTranslator('en').t('card.latePayment', { customerId: 'cus_x', delayDays: 21 })).toBe('cus_x will pay 21 days late.');
  });

  it('parses placeholders with and without a format', () => {
    expect([...placeholders('{a} and {b:money}')]).toEqual([
      ['a', undefined],
      ['b', 'money'],
    ]);
  });
});
