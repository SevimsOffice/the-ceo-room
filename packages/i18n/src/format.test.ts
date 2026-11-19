import { describe, expect, it } from 'vitest';
import {
  MINUS,
  formatBps,
  formatBpsPoints,
  formatDays,
  formatDecimal,
  formatInt,
  formatMoney,
  formatMoneyFull,
  formatMoneyParts,
  formatScore,
  formatScoreDelta,
  formatScorePercent,
  formatSignedBps,
  formatSignedInt,
  formatSignedMoney,
  formatSimDay,
  trendMark,
} from './format';

describe('money (kuruş)', () => {
  it('compact: TR "76,4 milyon TL", EN "76.4M TL"', () => {
    expect(formatMoney(7_640_000_000, 'tr')).toBe('76,4 milyon TL');
    expect(formatMoney(7_640_000_000, 'en')).toBe('76.4M TL');
  });
  it('drops a trailing ,0 and scales to bin / milyar', () => {
    expect(formatMoney(16_800_000_000, 'tr')).toBe('168 milyon TL');
    expect(formatMoney(16_566_000_000, 'en')).toBe('165.7M TL');
    expect(formatMoney(45_000_000, 'tr')).toBe('450 bin TL');
    expect(formatMoney(45_000_000, 'en')).toBe('450K TL');
    expect(formatMoney(250_000_000_000, 'tr')).toBe('2,5 milyar TL');
    expect(formatMoney(250_000_000_000, 'en')).toBe('2.5B TL');
    expect(formatMoney(98_700, 'tr')).toBe('987 TL');
  });
  it('moves up a scale when rounding reaches 1000', () => {
    expect(formatMoney(99_996_000_000, 'en')).toBe('1B TL');
  });
  it('negative figures use a typographic minus', () => {
    expect(formatMoney(-120_000_000, 'tr')).toBe(`${MINUS}1,2 milyon TL`);
    expect(formatSignedMoney(120_000_000, 'en')).toBe('+1.2M TL');
    expect(formatSignedMoney(-120_000_000, 'en')).toBe(`${MINUS}1.2M TL`);
  });
  it('parts split figure and unit for the typed report', () => {
    expect(formatMoneyParts(4_120_000_000, 'tr')).toEqual({ value: '41,2', unit: 'milyon TL' });
    expect(formatMoneyParts(4_120_000_000, 'en')).toEqual({ value: '41.2', unit: 'M TL' });
  });
  it('full money is exact to the kuruş', () => {
    expect(formatMoneyFull(7_640_000_012, 'tr')).toBe('76.400.000,12 TL');
    expect(formatMoneyFull(7_640_000_012, 'en')).toBe('76,400,000.12 TL');
    expect(formatMoneyFull(4560, 'tr')).toBe('45,60 TL');
    expect(formatMoneyFull(-5, 'en')).toBe(`${MINUS}0.05 TL`);
  });
  it('other currencies print their code', () => {
    expect(formatMoney(150_000_000, 'en', 'EUR')).toBe('1.5M EUR');
  });
});

describe('percentages (bps)', () => {
  it('TR puts % first, EN after', () => {
    expect(formatBps(9180, 'tr')).toBe('%92');
    expect(formatBps(9180, 'en')).toBe('92%');
  });
  it('decimals on request or auto', () => {
    expect(formatBps(2140, 'tr', 1)).toBe('%21,4');
    expect(formatBps(930, 'en', 1)).toBe('9.3%');
    expect(formatBps(2000, 'tr', 'auto')).toBe('%20');
    expect(formatBps(151, 'tr', 'auto')).toBe('%1,5');
    expect(formatBps(596, 'en', 'auto')).toBe('6%');
  });
  it('signed', () => {
    expect(formatSignedBps(596, 'tr')).toBe('+%6');
    expect(formatSignedBps(596, 'tr', 'auto')).toBe('+%6');
    expect(formatSignedBps(2140, 'en', 'auto')).toBe('+21.4%');
    expect(formatSignedBps(596, 'en')).toBe('+6%');
    expect(formatSignedBps(-200, 'en')).toBe(`${MINUS}2%`);
    expect(formatSignedBps(0, 'tr')).toBe('%0');
    expect(formatSignedBps(20, 'tr')).toBe('%0');
  });
  it('percentage points', () => {
    expect(formatBpsPoints(-110, 'tr')).toBe(`${MINUS}1,1 puan`);
    expect(formatBpsPoints(250, 'en')).toBe('+2.5 pts');
    expect(formatBpsPoints(0, 'en')).toBe('0 pts');
  });
});

describe('satisfaction score', () => {
  it('as points and as a share of 100', () => {
    expect(formatScore(8125, 'en')).toBe('81');
    expect(formatScorePercent(8125, 'tr')).toBe('%81');
    expect(formatScorePercent(8125, 'en')).toBe('81%');
  });
  it('signed delta in points', () => {
    expect(formatScoreDelta(-375, 'tr')).toBe(`${MINUS}3,8 puan`);
    expect(formatScoreDelta(-375, 'en')).toBe(`${MINUS}3.8 points`);
    expect(formatScoreDelta(400, 'en')).toBe('+4 points');
    expect(formatScoreDelta(100, 'en')).toBe('+1 point');
  });
});

describe('days and integers', () => {
  it('durations and sim days', () => {
    expect(formatDays(45, 'tr')).toBe('45 gün');
    expect(formatDays(45, 'en')).toBe('45 days');
    expect(formatDays(1, 'en')).toBe('1 day');
    expect(formatSimDay(46, 'tr')).toBe('Gün 46');
    expect(formatSimDay(46, 'en')).toBe('Day 46');
  });
  it('grouping and signs', () => {
    expect(formatInt(1234567, 'tr')).toBe('1.234.567');
    expect(formatInt(1234567, 'en')).toBe('1,234,567');
    expect(formatSignedInt(3, 'en')).toBe('+3');
    expect(formatSignedInt(-3, 'en')).toBe(`${MINUS}3`);
    expect(formatDecimal(-0.04, 'en', 1)).toBe('0.0');
  });
  it('trend marks', () => {
    expect(trendMark(5)).toBe('▲');
    expect(trendMark(-5)).toBe('▼');
    expect(trendMark(0)).toBe('');
    expect(trendMark(null)).toBe('');
  });
});
