/**
 * Import profiles: what a template cannot carry. A profile supplies the company record's identity,
 * engine settings that are not company facts in the template, department narrative (heads, notes),
 * i18n label keys for known records, and the event cards (storyline or data-driven).
 */
import { type Department, type DepartmentId, type EventCard, type SeedBundle, type Settings, money } from '@ceo-room/engine';
import { loadSeed } from '@ceo-room/seed-data';

/** The bundle as built from the workbook, before the profile's event cards are added. */
export type BundleWithoutCards = Omit<SeedBundle, 'eventCards'>;

export interface ImportProfile {
  id: string;
  company: {
    id: string;
    /** i18n key of the company name; null = use `company.imported` with the template's plain name */
    nameKey: string | null;
    seedVersion: number;
    /** the sample company stays simulated when imported from its own template */
    simulated: boolean;
  };
  /** engine settings the template does not ask for */
  settings: Pick<Settings, 'periodLengthDays' | 'runwayHorizonDays' | 'turnoverBpsPerOvertimeHourPerHead'>;
  /** i18n label keys of known records (id → key); records without one keep their plain name */
  labelKeys: { productFamilies: Readonly<Record<string, string>>; materials: Readonly<Record<string, string>> };
  /** department records in display order; `workspaceId` is stamped by the import */
  departments: () => Department[];
  eventCards: (bundle: BundleWithoutCards) => EventCard[];
}

const DEPARTMENT_SHAPE: Record<DepartmentId, { headTitleKey: string; kpis: string[]; dependsOn: DepartmentId[] }> = {
  sales: { headTitleKey: 'title.salesDirector', kpis: ['kpi.revenue', 'kpi.backlogValue', 'kpi.openOrders'], dependsOn: ['operations', 'finance'] },
  operations: { headTitleKey: 'title.coo', kpis: ['kpi.capacityUtilisation', 'kpi.deliverySlip', 'kpi.overtimeHours'], dependsOn: ['procurement', 'people'] },
  procurement: { headTitleKey: 'title.supplyChainDirector', kpis: ['kpi.materialCoverage', 'kpi.supplierReliability'], dependsOn: ['finance'] },
  finance: { headTitleKey: 'title.cfo', kpis: ['kpi.cash', 'kpi.runway', 'kpi.grossMargin'], dependsOn: ['sales'] },
  people: { headTitleKey: 'title.chro', kpis: ['kpi.turnover', 'kpi.headcount'], dependsOn: ['operations'] },
  cx: { headTitleKey: 'title.cxDirector', kpis: ['kpi.satisfaction', 'kpi.churnRisk'], dependsOn: ['sales', 'operations'] },
};

/** Six departments with titles, KPIs and dependencies but no head names or narrative (no personal data). */
export function genericDepartments(workspaceId = ''): Department[] {
  return (Object.keys(DEPARTMENT_SHAPE) as DepartmentId[]).map((id) => ({
    workspaceId,
    id,
    nameKey: `department.${id}`,
    headName: '',
    headTitleKey: DEPARTMENT_SHAPE[id].headTitleKey,
    kpis: [...DEPARTMENT_SHAPE[id].kpis],
    constraints: [],
    activeTasks: [],
    risks: [],
    dependsOn: [...DEPARTMENT_SHAPE[id].dependsOn],
  }));
}

/** Operations turnover above which the generic `turnoverRising` telegram fires (at least 2× the base rate). */
export const GENERIC_TURNOVER_ALERT_BPS = 400;

/**
 * Data-driven cards for a real company, using the engine's condition triggers only (no scripted
 * storyline): `cashSqueeze` when cash falls below one month of fixed costs (payroll from Workforce
 * plus every other fixed cost per 30 days), `turnoverRising` when operations turnover passes
 * max(4%, 2 × its base rate). Late payments and capacity strain have no condition trigger in the
 * engine yet, so no cards for them (docs/DATA_IMPORT_DESIGN.md §4).
 */
export function genericEventCards(b: BundleWithoutCards): EventCard[] {
  const ws = b.finance.workspaceId;
  let monthly = b.workforce.reduce((t, w) => t + w.headcount * w.avgMonthlyCost, 0);
  for (const c of b.finance.recurringCosts) if (c.kind !== 'payroll') monthly += Math.round((c.amount * 30) / c.everyDays);
  const cards: EventCard[] = [];
  if (monthly > 0) {
    cards.push({
      workspaceId: ws,
      id: 'card_cash_squeeze',
      kindKey: 'cashSqueeze',
      severity: 'high',
      trigger: { kind: 'cashBelow', threshold: money(monthly), fromDay: 2 },
      effect: { kind: 'notice' },
    });
  }
  const ops = b.workforce.find((w) => w.departmentId === 'operations');
  if (ops && ops.headcount > 0) {
    cards.push({
      workspaceId: ws,
      id: 'card_turnover',
      kindKey: 'turnoverRising',
      severity: 'medium',
      trigger: { kind: 'turnoverAbove', departmentId: 'operations', thresholdBps: Math.max(GENERIC_TURNOVER_ALERT_BPS, ops.baseTurnoverBps * 2), fromDay: 2 },
      effect: { kind: 'notice' },
    });
  }
  return cards;
}

/** Profile for real companies: generic departments, data-driven cards, the engine's standard settings. */
export const GENERIC_PROFILE: ImportProfile = {
  id: 'generic',
  company: { id: 'company', nameKey: null, seedVersion: 1, simulated: false },
  // Same values as the sample company: a 30-day period, a 180-day runway view, 0.12% turnover per overtime hour per head.
  settings: { periodLengthDays: 30, runwayHorizonDays: 180, turnoverBpsPerOvertimeHourPerHead: 12 },
  labelKeys: { productFamilies: {}, materials: {} },
  departments: () => genericDepartments(),
  eventCards: genericEventCards,
};

function novaraProfile(): ImportProfile {
  const seed = loadSeed();
  const c = seed.company.company;
  const st = seed.company.settings;
  return {
    id: 'novara',
    company: { id: c.id, nameKey: c.nameKey, seedVersion: c.seedVersion, simulated: true },
    settings: { periodLengthDays: st.periodLengthDays, runwayHorizonDays: st.runwayHorizonDays, turnoverBpsPerOvertimeHourPerHead: st.turnoverBpsPerOvertimeHourPerHead },
    labelKeys: {
      productFamilies: Object.fromEntries(seed.productFamilies.map((f) => [f.id, f.nameKey])),
      materials: Object.fromEntries(seed.materials.map((m) => [m.id, m.nameKey])),
    },
    departments: () => JSON.parse(JSON.stringify(seed.departments)) as Department[],
    eventCards: () => JSON.parse(JSON.stringify(seed.eventCards)) as EventCard[],
  };
}

/** Profile of the sample company: its storyline cards, department narrative, label keys and settings. */
export const NOVARA_PROFILE: ImportProfile = novaraProfile();
