import type { CardEffect, CompanyState } from './model/types';
import type { EventType } from './events/types';
import { HEALTH_WEIGHTS } from './config/tuning';
import { WEEKDAY_CODES } from './selectors/desk';

/**
 * Catalogue of every i18n code the engine can emit, with the names of its params, so the UI can test
 * that its tr/en catalogues are complete. Codes are grouped by `kind`. Params whose value is itself
 * a code: `reasonCode` (reason.*), `reason` (error.*). A test runs every decision path for 90 days
 * and checks that nothing outside this list is emitted (src/messages.test.ts).
 */
export type MessageKind =
  | 'ledger'
  | 'error'
  | 'card'
  | 'reason'
  | 'decision'
  | 'option'
  | 'assumption'
  | 'advisor'
  | 'role'
  | 'figure'
  | 'risk'
  | 'cashflow'
  | 'weekday'
  | 'health'
  | 'label'
  | 'seed';

export interface MessageCodeSpec {
  code: string;
  params: readonly string[];
  kind: MessageKind;
}

/** Ledger line params per event type (`ledger.<Type>`); typed so a new event type must be added here. */
export const LEDGER_PARAMS: Readonly<Record<EventType, readonly string[]>> = {
  SeedLoaded: ['seedVersion'],
  CommandAccepted: ['commandId', 'commandType'],
  DayStarted: ['day'],
  PeriodClosed: ['period', 'revenue'],
  DailyKpiRecorded: ['day'],
  RngAdvanced: [],
  DevelopmentArrived: ['cardId', 'severity'],
  DevelopmentRead: ['developmentId'],
  DevelopmentResolved: ['developmentId'],
  DecisionOpened: ['decisionId', 'deadlineDay'],
  DecisionResolved: ['decisionId', 'status', 'optionId'],
  DecisionDefaultFailed: ['decisionId', 'optionId', 'reason'],
  AnalysisRequested: ['decisionId', 'readyDay'],
  OrderReceived: ['orderId', 'customerId', 'familyId', 'qty', 'value', 'requestedDay'],
  OrderPlanned: ['orderId', 'plantId', 'promisedDay', 'lateDays', 'overtimeLineHours', 'marginBps'],
  OrderRecosted: ['orderId', 'costEstimate', 'previous'],
  OrderRepriced: ['orderId', 'customerId', 'previousValue', 'value'],
  OrderShipped: ['orderId', 'customerId', 'value', 'lateDays'],
  OrderPaid: ['orderId'],
  PurchaseOrderPlaced: ['poId', 'supplierId', 'materialId', 'qty', 'amount', 'dueDay'],
  PurchaseOrderRepriced: ['poId', 'previousPrice', 'unitPrice'],
  PurchaseOrderCancelled: ['poId', 'supplierId'],
  PurchaseOrderDelayed: ['poId', 'supplierId', 'delayDays'],
  PurchaseOrderDelivered: ['poId', 'materialId', 'qty'],
  PayableCreated: ['poId', 'amount', 'dueDay'],
  PayableSettled: ['payableId', 'counterpartyId', 'amount'],
  PayableCancelled: ['payableId', 'poId', 'amount'],
  DepositForfeited: ['poId', 'supplierId', 'amount'],
  ReceivableCreated: ['orderId', 'amount', 'dueDay'],
  ReceivableCollected: ['receivableId', 'customerId', 'amount'],
  ReceivableDelayed: ['receivableId', 'customerId', 'delayDays'],
  RecurringCostPaid: ['costId', 'kind', 'amount'],
  SupplierPriceChanged: ['supplierId', 'materialId', 'previousPrice', 'unitPrice'],
  PreferredSupplierChanged: ['materialId', 'supplierId', 'previousSupplierId'],
  SupplierOnboardingStarted: ['supplierId', 'firstDeliveryDay'],
  ProductionProgressed: ['orderId', 'plantId', 'units'],
  MaterialShortage: ['orderId', 'materialId'],
  ProductionResumed: ['orderId'],
  OvertimeWorked: ['plantId', 'personHours'],
  LineDown: ['lineId', 'repairDueDay'],
  LineRepaired: ['lineId'],
  CustomerSatisfactionChanged: ['customerId', 'delta', 'satisfaction', 'reasonCode'],
  CustomerTermsChanged: ['customerId', 'paymentDelayDays', 'discountBps'],
  CustomerChurned: ['customerId', 'churnRisk'],
  CustomerOrderCycleAdvanced: ['customerId'],
  EmployeeLeft: ['departmentId'],
};

/** Telegram params per card effect (rules/cards.ts messageParams); the code is `card.<kindKey>` from the seed. */
export const CARD_PARAMS: Readonly<Record<CardEffect['kind'], readonly string[]>> = {
  largeOrder: ['customerId', 'familyId', 'qty', 'value', 'requestedDay', 'paymentTermsDays'],
  supplierPriceChange: ['supplierId', 'materialId', 'changeBps'],
  discountDemand: ['customerId', 'discountBps'],
  lineBreakdown: ['lineId', 'repairDays'],
  latePayment: ['customerId', 'delayDays'],
  notice: [],
};

const FIELD = ['type', 'field'];
const RANGE = ['type', 'field', 'min', 'max'];

/**
 * Fallback i18n keys an imported company's records use (company / product / material / line type /
 * customer segment). The record's plain `name` (or `kindName`) is what the UI shows; these keys name
 * the kind of record when no plain label exists.
 */
export const IMPORTED_LABEL_KEYS = ['company.imported', 'product.imported', 'material.imported', 'line.imported', 'segment.general'] as const;

const STATIC: readonly MessageCodeSpec[] = [
  // ---- command and save-game errors (commands/handle.ts, core.ts, engine.ts) ----
  ...(
    [
      ['error.invalidCommand', []],
      ['error.commandNotAllowed', ['type']],
      ['error.unexpectedField', FIELD],
      ['error.missingField', FIELD],
      ['error.invalidField', FIELD],
      ['error.invalidAmount', RANGE],
      ['error.invalidRate', RANGE],
      ['error.invalidScore', RANGE],
      ['error.unknownSupplier', ['supplierId']],
      ['error.noOffer', ['supplierId', 'materialId']],
      ['error.unknownMaterial', ['materialId']],
      ['error.alreadyPreferred', ['supplierId']],
      ['error.noPriceChangeToPass', ['materialId']],
      ['error.unknownCustomer', ['customerId']],
      ['error.unknownDecision', ['decisionId']],
      ['error.decisionClosed', ['decisionId', 'status']],
      ['error.unknownOption', ['decisionId', 'optionId']],
      ['error.analysisAlreadyRequested', ['decisionId']],
      ['error.unknownDevelopment', ['developmentId']],
      ['error.developmentNotNew', ['developmentId', 'status']],
      ['error.developmentHasOpenDecision', ['developmentId', 'decisionId']],
      ['error.emptyCustomDecision', ['decisionId']],
      ['error.saveFormat', ['format']],
      ['error.seedVersionMismatch', ['save', 'seed']],
      ['error.replayFailed', ['reason']],
    ] as const
  ).map(([code, params]) => ({ code, params, kind: 'error' as const })),
  // ---- customer reaction reasons (CustomerSatisfactionChanged.reasonCode) ----
  ...['reason.onTime', 'reason.late', 'reason.overdueOrder', 'reason.priceIncrease', 'reason.discountGranted', 'reason.discountPartial', 'reason.discountRefused'].map(
    (code) => ({ code, params: [], kind: 'reason' as const }),
  ),
  // ---- decisions (rules/decisions.ts) ----
  { code: 'decision.supplierPrice.situation', params: ['supplierId', 'materialId', 'changeBps', 'previousPrice', 'newPrice'], kind: 'decision' },
  { code: 'decision.discountDemand.situation', params: ['customerId', 'discountBps'], kind: 'decision' },
  ...['option.supplierPrice.absorb', 'option.supplierPrice.negotiate', 'option.supplierPrice.switch', 'option.supplierPrice.passOn', 'option.discount.grant', 'option.discount.refuse'].map(
    (code) => ({ code, params: [], kind: 'option' as const }),
  ),
  ...(
    [
      ['assumption.absorbIncrease', ['supplierId', 'materialId', 'changeBps']],
      ['assumption.negotiationSettles', ['supplierId', 'materialId', 'settleBps']],
      ['assumption.volumeCommitment', ['supplierId', 'materialId', 'qty']],
      ['assumption.normalPaymentTerms', ['supplierId', 'days']],
      ['assumption.alternativePrice', ['supplierId', 'unitPrice']],
      ['assumption.depositUpFront', ['supplierId', 'depositBps', 'days']],
      ['assumption.firstLeadTime', ['supplierId', 'leadTimeDays', 'onboardingDays']],
      ['assumption.reliability', ['supplierId', 'reliabilityBps']],
      ['assumption.fullPassThrough', ['materialId']],
      ['assumption.customerReaction', ['satisfactionDelta', 'churnRiskDelta', 'paymentDelayDays']],
      ['assumption.discountOnOpenOrders', ['discountBps']],
      ['assumption.advisor.expectedPath', []],
      ['assumption.advisor.cfoHorizon', ['horizonDays', 'deepHorizonDays']],
      ['assumption.advisor.cooScope', ['materialId']],
    ] as const
  ).map(([code, params]) => ({ code, params, kind: 'assumption' as const })),
  // ---- advisors (rules/advisors.ts) ----
  { code: 'advisor.cfo.objective', params: ['horizonDays', 'deepHorizonDays'], kind: 'advisor' },
  { code: 'advisor.cfo.rationale', params: ['optionId', 'minCashDelta', 'minCashDelta30', 'minCashDelta90', 'marginDelta', 'runwayDays'], kind: 'advisor' },
  { code: 'advisor.coo.objective', params: ['horizonDays', 'deepHorizonDays'], kind: 'advisor' },
  { code: 'advisor.coo.rationale', params: ['optionId', 'slipDelta', 'coverageDays'], kind: 'advisor' },
  { code: 'advisor.caveat.deferredPayables', params: ['optionId', 'amount', 'fromDay'], kind: 'advisor' },
  { code: 'advisor.caveat.pickChangedAt90', params: ['thirtyDayOptionId', 'optionId', 'horizonDays'], kind: 'advisor' },
  { code: 'role.cfo', params: [], kind: 'role' },
  { code: 'role.coo', params: [], kind: 'role' },
  // ---- Decision Room supporting figures (selectors/index.ts) ----
  ...['figure.cash', 'figure.runwayDays', 'figure.backlogValue', 'figure.grossMarginBps', 'figure.affectedOrders', 'figure.affectedOrderValue'].map(
    (code) => ({ code, params: [], kind: 'figure' as const }),
  ),
  // ---- risk factors (rules/risk.ts) ----
  ...(
    [
      ['risk.cashNegative', ['cash', 'points']],
      ['risk.cashLow', ['cash', 'points']],
      ['risk.lateOrders', ['lateOrders', 'points']],
      ['risk.materialShortage', ['blockedOrders', 'points']],
      ['risk.customerChurn', ['churnRisk', 'points']],
      ['risk.turnover', ['turnoverBps', 'points']],
      ['risk.lineDown', ['lines', 'points']],
    ] as const
  ).map(([code, params]) => ({ code, params, kind: 'risk' as const })),
  // ---- order plan cash curve (systems/pipeline.ts) ----
  ...['cashflow.supplierDeposit', 'cashflow.supplierPayment', 'cashflow.energy', 'cashflow.overtime', 'cashflow.customerReceipt'].map(
    (code) => ({ code, params: [], kind: 'cashflow' as const }),
  ),
  // ---- generic labels of imported companies (records carry a plain `name` / `kindName` beside them) ----
  ...IMPORTED_LABEL_KEYS.map((code) => ({ code, params: [], kind: 'label' as const })),
  // ---- calendar and health (selectors/desk.ts) ----
  ...WEEKDAY_CODES.map((code) => ({ code, params: [], kind: 'weekday' as const })),
  ...['good', 'fair', 'poor', 'critical'].map((b) => ({ code: `health.band.${b}`, params: [], kind: 'health' as const })),
  ...Object.keys(HEALTH_WEIGHTS).map((id) => ({ code: `health.component.${id}`, params: [], kind: 'health' as const })),
];

const LEDGER: readonly MessageCodeSpec[] = (Object.keys(LEDGER_PARAMS) as EventType[]).map((t) => ({
  code: `ledger.${t}`,
  params: LEDGER_PARAMS[t],
  kind: 'ledger' as const,
}));

/**
 * Codes defined by the loaded company (seed): telegram codes `card.<kindKey>` with the params of
 * their effect, and the seed's name/title/segment/line keys and department notes.
 */
function seedCodes(s: CompanyState): MessageCodeSpec[] {
  const out: MessageCodeSpec[] = [];
  for (const c of s.eventCards) out.push({ code: `card.${c.kindKey}`, params: CARD_PARAMS[c.effect.kind], kind: 'card' });
  const key = (code: string): void => {
    out.push({ code, params: [], kind: 'seed' });
  };
  key(s.company.nameKey);
  for (const d of s.departments) {
    key(d.nameKey);
    key(d.headTitleKey);
    for (const k of d.kpis) key(k);
    for (const m of [...d.constraints, ...d.activeTasks, ...d.risks]) out.push({ code: m.code, params: Object.keys(m.params), kind: 'seed' });
  }
  for (const f of s.productFamilies) key(f.nameKey);
  for (const m of s.materials) key(m.nameKey);
  for (const c of s.customers) key(c.segmentKey);
  for (const l of s.lines) key(l.kindKey);
  return out;
}

/**
 * Every i18n code the engine can emit, with param names. Without a state: the engine's own codes.
 * With a state: also the codes its seed defines (telegram cards, names, titles, department notes).
 * Sorted by code; a code appears once (params merged).
 */
export function listMessageCodes(s?: CompanyState): MessageCodeSpec[] {
  const all = [...LEDGER, ...STATIC, ...(s ? seedCodes(s) : [])];
  const byCode = new Map<string, MessageCodeSpec>();
  for (const m of all) {
    const prev = byCode.get(m.code);
    byCode.set(m.code, prev ? { ...prev, params: [...new Set([...prev.params, ...m.params])] } : { ...m, params: [...m.params] });
  }
  return [...byCode.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
