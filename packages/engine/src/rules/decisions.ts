import type { CardEffect, CompanyState, Decision, EventCard } from '../model/types';
import { type Money, addM, mulBps, subM } from '../model/units';
import { byId } from '../events/reduce';
import { offerOf } from '../systems/costing';
import { pad } from '../systems/procurement';

type SupplierPriceEffect = Extract<CardEffect, { kind: 'supplierPriceChange' }>;
type DiscountEffect = Extract<CardEffect, { kind: 'discountDemand' }>;

export const nextDecisionId = (s: CompanyState): string => `dec-${pad(s.counters.decision)}`;

/**
 * Decision for a supplier price rise. Options are lists of commands (SIMULATION_DESIGN §5).
 * Prices are captured when the decision opens so the commands replay identically.
 */
export function buildSupplierPriceDecision(
  s: CompanyState,
  card: EventCard,
  effect: SupplierPriceEffect,
  developmentId: string,
  previousPrice: Money,
): Decision {
  const newPrice = addM(previousPrice, mulBps(previousPrice, effect.changeBps));
  const settled = addM(previousPrice, mulBps(previousPrice, effect.negotiation.settleBps));
  const supplier = byId(s.suppliers, effect.supplierId);
  const alt = byId(s.suppliers, effect.alternativeSupplierId);
  const altOffer = offerOf(s, alt.id, effect.materialId);
  const p = { supplierId: supplier.id, materialId: effect.materialId };
  return {
    workspaceId: s.workspaceId,
    id: nextDecisionId(s),
    kind: 'supplierPrice',
    developmentId,
    cardId: card.id,
    situation: {
      code: 'decision.supplierPrice.situation',
      params: { ...p, changeBps: effect.changeBps, previousPrice, newPrice },
    },
    status: 'open',
    openedDay: s.day,
    deadlineDay: s.day + effect.decisionDays,
    defaultOptionId: 'absorb',
    options: [
      {
        id: 'absorb',
        labelKey: 'option.supplierPrice.absorb',
        commands: [],
        assumptions: [{ code: 'assumption.absorbIncrease', params: { ...p, changeBps: effect.changeBps } }],
      },
      {
        id: 'negotiate',
        labelKey: 'option.supplierPrice.negotiate',
        commands: [
          { type: 'setSupplierPrice', supplierId: supplier.id, materialId: effect.materialId, unitPrice: settled },
          { type: 'placePurchaseOrder', supplierId: supplier.id, materialId: effect.materialId, qty: effect.negotiation.volumeQty },
        ],
        assumptions: [
          { code: 'assumption.negotiationSettles', params: { ...p, settleBps: effect.negotiation.settleBps } },
          { code: 'assumption.volumeCommitment', params: { ...p, qty: effect.negotiation.volumeQty } },
          { code: 'assumption.normalPaymentTerms', params: { supplierId: supplier.id, days: supplier.paymentTermsDays } },
        ],
      },
      {
        id: 'switch',
        labelKey: 'option.supplierPrice.switch',
        commands: [{ type: 'switchSupplier', materialId: effect.materialId, toSupplierId: alt.id }],
        assumptions: [
          { code: 'assumption.alternativePrice', params: { supplierId: alt.id, unitPrice: altOffer ? altOffer.unitPrice : 0 } },
          { code: 'assumption.depositUpFront', params: { supplierId: alt.id, depositBps: alt.depositBps, days: alt.paymentTermsDays } },
          {
            code: 'assumption.firstLeadTime',
            params: { supplierId: alt.id, leadTimeDays: altOffer ? altOffer.leadTimeDays : 0, onboardingDays: alt.onboardingDays },
          },
          { code: 'assumption.reliability', params: { supplierId: alt.id, reliabilityBps: alt.reliabilityBps } },
        ],
      },
      {
        id: 'passOn',
        labelKey: 'option.supplierPrice.passOn',
        commands: [
          {
            type: 'repriceOrders',
            materialId: effect.materialId,
            unitCostIncrease: subM(newPrice, previousPrice),
            passThroughBps: 10000,
            reaction: effect.customerReaction,
          },
        ],
        assumptions: [
          { code: 'assumption.fullPassThrough', params: { materialId: effect.materialId } },
          {
            code: 'assumption.customerReaction',
            params: {
              satisfactionDelta: effect.customerReaction.satisfactionDelta,
              churnRiskDelta: effect.customerReaction.churnRiskDelta,
              paymentDelayDays: effect.customerReaction.paymentDelayDays,
            },
          },
        ],
      },
    ],
    chosenOptionId: null,
    decidedDay: null,
    analysis: null,
    custom: null,
  };
}

export function buildDiscountDecision(
  s: CompanyState,
  card: EventCard,
  effect: DiscountEffect,
  developmentId: string,
): Decision {
  return {
    workspaceId: s.workspaceId,
    id: nextDecisionId(s),
    kind: 'discountDemand',
    developmentId,
    cardId: card.id,
    situation: {
      code: 'decision.discountDemand.situation',
      params: { customerId: effect.customerId, discountBps: effect.discountBps },
    },
    status: 'open',
    openedDay: s.day,
    deadlineDay: s.day + effect.decisionDays,
    defaultOptionId: 'refuse',
    options: [
      {
        id: 'grant',
        labelKey: 'option.discount.grant',
        commands: [
          {
            type: 'grantDiscount',
            customerId: effect.customerId,
            discountBps: effect.discountBps,
            satisfactionDelta: effect.acceptance.satisfactionDelta,
            churnRiskDelta: effect.acceptance.churnRiskDelta,
          },
        ],
        assumptions: [{ code: 'assumption.discountOnOpenOrders', params: { discountBps: effect.discountBps } }],
      },
      {
        id: 'refuse',
        labelKey: 'option.discount.refuse',
        commands: [
          {
            type: 'customerReaction',
            customerId: effect.customerId,
            satisfactionDelta: effect.refusal.satisfactionDelta,
            churnRiskDelta: effect.refusal.churnRiskDelta,
            reasonCode: 'reason.discountRefused',
          },
        ],
        assumptions: [
          {
            code: 'assumption.customerReaction',
            params: { satisfactionDelta: effect.refusal.satisfactionDelta, churnRiskDelta: effect.refusal.churnRiskDelta, paymentDelayDays: 0 },
          },
        ],
      },
    ],
    chosenOptionId: null,
    decidedDay: null,
    analysis: null,
    custom: null,
  };
}
