/**
 * Turns the engine's impact figures (selectDecision / previewCustomDecision) into the cells of the
 * Decision Room's notes. Pure: engine values and a translator in, text and tone out. Nothing is
 * computed here beyond choosing which engine value goes in which cell and how it is printed.
 */
import type { HorizonImpact, KpiSnapshot, RiskLevel } from '@ceo-room/engine';
import { type Translator, formatBps, formatDecimal, formatInt } from '@ceo-room/i18n';
import type { Tone } from '../desk/figures';

/** The rows of every note: cash, margin, delivery, customers, people (overtime, turnover), risk. */
export const METRICS = ['cash', 'margin', 'delivery', 'satisfaction', 'overtime', 'turnover', 'risk'] as const;
export type MetricId = (typeof METRICS)[number];

export interface Cell {
  text: string;
  tone: Tone;
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** A sign in front of a printed figure that is not zero once printed. */
const signed = (body: string, value: number): string => (value > 0 && /[1-9]/.test(body) ? `+${body}` : body);

/**
 * Money in millions of the currency (the unit sits in the row label): one decimal, two below a
 * million so that small sums still show ("−0,62"). kuruş / 10^8 = millions.
 */
export function millions(kurus: number, t: Translator, withSign: boolean): string {
  if (kurus === 0) return '0';
  const m = kurus / 1e8;
  const body = formatDecimal(m, t.locale, Math.abs(m) < 1 ? 2 : 1);
  return withSign ? signed(body, kurus) : body;
}

/** One decimal, trailing zero dropped: 74 bps → "0,7"; score 352 → "3,5". */
const hundredths = (v: number, t: Translator): string => signed(formatDecimal(v / 100, t.locale, 1, true), v);

/** Tone of a change: zero is muted; `upIsGood` says which way is better. */
export function toneOf(delta: number, upIsGood: boolean): Tone {
  if (delta === 0) return 'muted';
  return delta > 0 === upIsGood ? 'good' : 'bad';
}

/** A cell of an option: the change against the baseline at one horizon. */
export function deltaCell(t: Translator, metric: MetricId, h: HorizonImpact): Cell {
  const d = h.delta;
  switch (metric) {
    case 'cash':
      return { text: millions(d.cash, t, true), tone: toneOf(d.cash, true) };
    case 'margin':
      return { text: hundredths(d.grossMarginBps, t), tone: toneOf(d.grossMarginBps, true) };
    case 'delivery':
      return { text: signed(formatInt(d.deliverySlipDays, t.locale), d.deliverySlipDays), tone: toneOf(d.deliverySlipDays, false) };
    case 'satisfaction':
      return { text: hundredths(d.avgSatisfaction, t), tone: toneOf(d.avgSatisfaction, true) };
    case 'overtime':
      return { text: signed(formatInt(d.overtimeHours, t.locale), d.overtimeHours), tone: toneOf(d.overtimeHours, false) };
    case 'turnover':
      return { text: hundredths(d.turnoverBps, t), tone: toneOf(d.turnoverBps, false) };
    case 'risk': {
      const diff = RISK_ORDER[h.risk.option] - RISK_ORDER[h.risk.baseline];
      return { text: t.t(`ui.room.risk.${h.risk.option}`), tone: toneOf(diff, false) };
    }
  }
}

/** A cell of the baseline: the figure itself at one horizon (what happens if you reject). */
export function baselineCell(t: Translator, metric: MetricId, k: KpiSnapshot): Cell {
  switch (metric) {
    case 'cash':
      return { text: millions(k.cash, t, false), tone: k.cash < 0 ? 'bad' : 'ink' };
    case 'margin':
      return { text: formatBps(k.grossMarginBps, t.locale, 1), tone: 'ink' };
    case 'delivery':
      return { text: formatInt(k.deliverySlipDays, t.locale), tone: 'ink' };
    case 'satisfaction':
      return { text: formatDecimal(k.avgSatisfaction / 100, t.locale, 1, true), tone: 'ink' };
    case 'overtime':
      return { text: formatInt(k.overtimeHours, t.locale), tone: 'ink' };
    case 'turnover':
      return { text: formatBps(k.turnoverBps, t.locale, 1), tone: 'ink' };
    case 'risk':
      return { text: t.t(`ui.room.risk.${k.riskLevel}`), tone: k.riskLevel === 'low' ? 'ink' : k.riskLevel === 'medium' ? 'warn' : 'bad' };
  }
}

/** The row label and its unit line (the unit of the option deltas). */
export function metricLabel(t: Translator, metric: MetricId): { label: string; unit: string } {
  return { label: t.t(`ui.room.metric.${metric}`), unit: t.t(`ui.room.unit.${metric}`) };
}

/** The unit of the baseline's absolute figures (differs from the deltas' for percentages). */
export function baselineUnit(t: Translator, metric: MetricId): string {
  return t.t(`ui.room.baseUnit.${metric}`);
}

/** Column heading of a horizon: "+7 gün" with the day it lands on. */
export function horizonHeading(t: Translator, horizonDays: number, today: number): { title: string; day: string } {
  return { title: t.t('ui.room.horizon', { days: horizonDays }), day: t.t('ui.room.horizonDay', { day: today + horizonDays }) };
}
