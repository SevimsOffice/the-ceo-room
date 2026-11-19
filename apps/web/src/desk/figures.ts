/**
 * Turns selector output into the strings printed on the Desk. Pure: report + translator in,
 * text out. No figure is computed here beyond picking which engine value to show.
 */
import type { OverallHealth, Runway } from '@ceo-room/engine';
import {
  type Translator,
  formatBps,
  formatInt,
  formatMoneyParts,
  formatScorePercent,
  trendMark,
} from '@ceo-room/i18n';
import type { DeskReport, DeskThresholds } from '../worker/protocol';

export type Tone = 'ink' | 'good' | 'bad' | 'warn' | 'muted';

export interface ReportLine {
  id: 'revenue' | 'cash' | 'orders' | 'satisfaction' | 'capacity' | 'health' | 'turnover';
  label: string;
  /** the big typed figure */
  value: string;
  /** small text after it (unit) */
  unit: string;
  /** the line under the figure */
  note: string;
  tone: Tone;
}

/** The runway as printed: "52 gün", "180+ gün", or "hesaplanıyor…". */
export function runwayText(t: Translator, runway: Runway | null): string {
  if (!runway) return t.t('ui.runway.calculating');
  return runway.capped ? t.t('ui.runway.capped', { days: runway.horizonDays }) : t.t('ui.runway.days', { days: runway.days });
}

const toneOf = (delta: number | null, upIsGood = true): Tone => {
  if (delta === null || delta === 0) return 'muted';
  return delta > 0 === upIsGood ? 'good' : 'bad';
};

const withMark = (delta: number | null, text: string): string => {
  const m = trendMark(delta);
  return m ? `${m} ${text}` : text;
};

export function capacityTone(bps: number, th: DeskThresholds | null): { key: string; tone: Tone } {
  if (bps >= 10000) return { key: 'ui.report.capacity.over', tone: 'bad' };
  if (th && bps >= th.capacityComfortBps) return { key: 'ui.report.capacity.near', tone: 'warn' };
  return { key: 'ui.report.capacity.ok', tone: 'good' };
}

const bandTone: Record<OverallHealth['band'], Tone> = { good: 'good', fair: 'warn', poor: 'bad', critical: 'bad' };

/** The typed lines of the morning report, in order. */
export function reportLines(
  t: Translator,
  r: DeskReport,
  live: { runway: Runway; health: OverallHealth } | null,
  thresholds: DeskThresholds | null,
): ReportLine[] {
  const L = t.locale;
  const none = t.t('ui.figure.none');

  const rev = r.revenue.lastPeriod === null ? null : formatMoneyParts(r.revenue.lastPeriod, L, t.currency);
  const revenue: ReportLine = {
    id: 'revenue',
    label: t.t('ui.report.revenue'),
    value: rev ? rev.value : none,
    unit: rev ? rev.unit : '',
    note:
      r.revenue.lastPeriod === null
        ? t.t('ui.report.revenue.toDate', { amount: r.revenue.periodToDate })
        : r.revenue.changeBps === null
          ? t.t('ui.report.revenue.firstMonth')
          : withMark(r.revenue.changeBps, t.t('ui.report.revenue.change', { change: r.revenue.changeBps })),
    tone: r.revenue.lastPeriod === null || r.revenue.changeBps === null ? 'muted' : toneOf(r.revenue.changeBps),
  };

  const cashParts = formatMoneyParts(r.cash, L, t.currency);
  const cash: ReportLine = {
    id: 'cash',
    label: t.t('ui.report.cash'),
    value: cashParts.value,
    unit: cashParts.unit,
    note: t.t('ui.report.cash.runway', { runway: runwayText(t, live?.runway ?? null) }),
    tone: r.cash < 0 ? 'bad' : 'muted',
  };

  const orders: ReportLine = {
    id: 'orders',
    label: t.t('ui.report.orders'),
    value: formatInt(r.backlog.openOrders, L),
    unit: t.plural('ui.report.orders.detail', r.backlog.openOrders, { value: r.backlog.value }),
    note: t.t('ui.report.orders.open'),
    tone: 'muted',
  };

  const satisfaction: ReportLine = {
    id: 'satisfaction',
    label: t.t('ui.report.satisfaction'),
    value: formatScorePercent(r.satisfaction.average, L),
    unit: '',
    note:
      r.satisfaction.change === null
        ? t.t('ui.report.satisfaction.noPrevious')
        : withMark(r.satisfaction.change, t.t('ui.report.satisfaction.change', { delta: r.satisfaction.change })),
    tone: toneOf(r.satisfaction.change),
  };

  const cap = capacityTone(r.capacityUtilisationBps, thresholds);
  const capacity: ReportLine = {
    id: 'capacity',
    label: t.t('ui.report.capacity'),
    value: formatBps(r.capacityUtilisationBps, L),
    unit: '',
    note: t.t(cap.key),
    tone: cap.tone,
  };

  const health: ReportLine = live
    ? {
        id: 'health',
        label: t.t('ui.report.health'),
        value: formatInt(live.health.score, L),
        unit: t.t('ui.report.health.outOf'),
        note: t.t('ui.report.health.band', { band: t.t(live.health.code) }),
        tone: bandTone[live.health.band],
      }
    : {
        id: 'health',
        label: t.t('ui.report.health'),
        value: none,
        unit: '',
        note: t.t('ui.runway.calculating'),
        tone: 'muted',
      };

  const wf = r.workforce.total;
  const turnover: ReportLine = {
    id: 'turnover',
    label: t.t('ui.report.turnover'),
    value: formatBps(wf.turnoverBps, L, 1),
    unit: t.t('ui.report.turnover.perMonth'),
    note:
      wf.turnoverChangeBps === null
        ? t.t('ui.report.turnover.noPrevious')
        : withMark(wf.turnoverChangeBps, t.t('ui.report.turnover.change', { delta: wf.turnoverChangeBps })),
    tone: toneOf(wf.turnoverChangeBps, false),
  };

  return [revenue, cash, orders, satisfaction, capacity, health, turnover];
}

/** The note at the foot of the report. */
export function reportNote(t: Translator, unread: number): string {
  return unread === 0 ? t.t('ui.report.note.none') : t.plural('ui.report.note', unread);
}

/** "dev-0004" → "0004": the form number on a telegram. */
export function telegramNumber(id: string): string {
  return /(\d+)$/.exec(id)?.[1] ?? id;
}

/** "dec-0002" → 2: the folder number of a decision. */
export function decisionNumber(id: string): number {
  return Number(/(\d+)$/.exec(id)?.[1] ?? 0);
}

/** Days-left line on a decision folder. */
export function daysLeftText(t: Translator, daysLeft: number): string {
  return daysLeft <= 0 ? t.t('ui.decision.dueToday') : t.plural('ui.decision.daysLeft', daysLeft);
}
