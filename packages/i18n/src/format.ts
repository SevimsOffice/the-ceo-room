/**
 * Number formatting from engine units. Pure and locale-explicit (no Intl, no host locale): the
 * same input gives the same string in Node, the browser and the worker.
 *
 * Engine units: money = integer kuruş, Bps = basis points (10000 = 100%), Score = hundredths of a
 * 0–100 point (8125 = 81.25), SimDay = integer day number (Day 1 = Monday).
 */

export type Locale = 'tr' | 'en';
export const LOCALES: readonly Locale[] = ['tr', 'en'];

/** Typographic minus (U+2212), used for every negative figure. */
export const MINUS = '−';

interface Separators {
  group: string;
  decimal: string;
}

const SEP: Record<Locale, Separators> = {
  tr: { group: '.', decimal: ',' },
  en: { group: ',', decimal: '.' },
};

/** Currency code → the sign printed after the figure. TRY prints as "TL". */
export function currencySign(currency: string): string {
  return currency === 'TRY' ? 'TL' : currency;
}

function groupDigits(digits: string, sep: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += sep;
    out += digits[i];
  }
  return out;
}

/**
 * Formats a non-negative or negative number with fixed decimals, locale separators and a
 * typographic minus. `trim` drops trailing zero decimals ("76,0" → "76").
 */
export function formatDecimal(value: number, locale: Locale, decimals = 0, trim = false): string {
  const sep = SEP[locale];
  const factor = 10 ** decimals;
  const scaled = Math.round(Math.abs(value) * factor);
  const neg = value < 0 && scaled !== 0;
  const whole = Math.floor(scaled / factor);
  let frac = decimals > 0 ? String(scaled % factor).padStart(decimals, '0') : '';
  if (trim) frac = frac.replace(/0+$/, '');
  const body = groupDigits(String(whole), sep.group) + (frac ? sep.decimal + frac : '');
  return (neg ? MINUS : '') + body;
}

/** Integer with grouping: 12345 → "12.345" (tr) / "12,345" (en). */
export function formatInt(value: number, locale: Locale): string {
  return formatDecimal(Math.round(value), locale, 0);
}

/** Signed integer: "+3", "−3", "0". */
export function formatSignedInt(value: number, locale: Locale): string {
  const v = Math.round(value);
  return (v > 0 ? '+' : '') + formatInt(v, locale);
}

// ---- Money ---------------------------------------------------------------------------------

export interface MoneyParts {
  /** the figure, with sign: "76,4" / "−1.2" */
  value: string;
  /** what follows it: "milyon TL" / "M TL" / "TL" */
  unit: string;
}

const SCALES: readonly { min: number; tr: string; en: string }[] = [
  { min: 1e9, tr: 'milyar', en: 'B' },
  { min: 1e6, tr: 'milyon', en: 'M' },
  { min: 1e3, tr: 'bin', en: 'K' },
];

/**
 * Compact money in parts. kuruş → lira, scaled to bin/milyon/milyar (K/M/B) with one decimal
 * (trailing ",0" dropped). Below 1 000 TL the figure is whole lira.
 */
export function formatMoneyParts(kurus: number, locale: Locale, currency = 'TRY'): MoneyParts {
  const sign = currencySign(currency);
  const lira = kurus / 100;
  const abs = Math.abs(lira);
  // the unit is chosen on the figure as printed: 999,50 TL prints as 1 000 TL, so it is "1 bin TL"
  const printed = Math.round(abs);
  for (let i = 0; i < SCALES.length; i++) {
    const s = SCALES[i]!;
    if (printed < s.min) continue;
    let scaled = Math.round((abs / s.min) * 10) / 10;
    let scale = s;
    // 999.96 M rounds to 1000.0 M: move up one scale.
    if (scaled >= 1000 && i > 0) {
      scale = SCALES[i - 1]!;
      scaled = Math.round((abs / scale.min) * 10) / 10;
    }
    const value = formatDecimal(lira < 0 ? -scaled : scaled, locale, 1, true);
    return { value, unit: locale === 'tr' ? `${scale.tr} ${sign}` : `${scale.en} ${sign}` };
  }
  return { value: formatDecimal(lira, locale, 0), unit: sign };
}

/** Compact money: 7 640 000 000 kuruş → "76,4 milyon TL" (tr) / "76.4M TL" (en). */
export function formatMoney(kurus: number, locale: Locale, currency = 'TRY'): string {
  const p = formatMoneyParts(kurus, locale, currency);
  if (locale === 'en' && p.unit !== currencySign(currency)) {
    // "76.4M TL": scale letter sticks to the figure
    const [scale, ...rest] = p.unit.split(' ');
    return `${p.value}${scale} ${rest.join(' ')}`;
  }
  return `${p.value} ${p.unit}`;
}

/** Full money, exact to the kuruş: "76.400.000,00 TL" (tr) / "76,400,000.00 TL" (en). */
export function formatMoneyFull(kurus: number, locale: Locale, currency = 'TRY'): string {
  const k = Math.round(kurus);
  const abs = Math.abs(k);
  const sep = SEP[locale];
  const body = groupDigits(String(Math.floor(abs / 100)), sep.group) + sep.decimal + String(abs % 100).padStart(2, '0');
  return `${k < 0 ? MINUS : ''}${body} ${currencySign(currency)}`;
}

/**
 * Signed compact money: "+1,2 milyon TL", "−450 bin TL". The sign follows the figure as printed
 * (same rule as formatSignedBps): 49 kuruş prints "0 TL", with no sign.
 */
export function formatSignedMoney(kurus: number, locale: Locale, currency = 'TRY'): string {
  const s = formatMoney(kurus, locale, currency);
  return kurus > 0 && /[1-9]/.test(s) ? `+${s}` : s;
}

// ---- Percentages (basis points) ------------------------------------------------------------

function pct(body: string, locale: Locale): string {
  return locale === 'tr' ? `%${body}` : `${body}%`;
}

/**
 * 9180 bps → "%92" (tr) / "92%" (en). `decimals` default 0; 'auto' = one decimal with a trailing
 * zero dropped (596 → "%6", 151 → "%1,5"). Negative: "−%5" / "−5%".
 */
export function formatBps(bps: number, locale: Locale, decimals: number | 'auto' = 0): string {
  const body = decimals === 'auto' ? formatDecimal(Math.abs(bps) / 100, locale, 1, true) : formatDecimal(Math.abs(bps) / 100, locale, decimals);
  const neg = bps < 0 && body.replace(/[^1-9]/g, '') !== '';
  return (neg ? MINUS : '') + pct(body, locale);
}

/** Signed percentage: 596 → "+%6" / "+6%"; −200 → "−%2" / "−2%". */
export function formatSignedBps(bps: number, locale: Locale, decimals: number | 'auto' = 0): string {
  const s = formatBps(bps, locale, decimals);
  return bps > 0 && /[1-9]/.test(s) ? `+${s}` : s;
}

/** A change in a percentage, in percentage points: −110 bps → "−1,1 puan" / "−1.1 pts". */
export function formatBpsPoints(bps: number, locale: Locale): string {
  const body = formatDecimal(bps / 100, locale, 1, true);
  const signed = bps > 0 && /[1-9]/.test(body) ? `+${body}` : body;
  return locale === 'tr' ? `${signed} puan` : `${signed} pts`;
}

// ---- Scores (customer satisfaction) --------------------------------------------------------

/** Score (hundredths of a 0–100 point) as a whole number of points: 8125 → "81". */
export function formatScore(score: number, locale: Locale): string {
  return formatDecimal(score / 100, locale, 0);
}

/** Score as a share of 100: 8125 → "%81" / "81%". */
export function formatScorePercent(score: number, locale: Locale): string {
  return formatBps(score, locale, 0);
}

/** Signed change in points: −375 → "−3,8 puan" / "−3.8 points"; one decimal, trailing zero dropped. */
export function formatScoreDelta(delta: number, locale: Locale): string {
  const body = formatDecimal(delta / 100, locale, 1, true);
  const signed = delta > 0 && /[1-9]/.test(body) ? `+${body}` : body;
  if (locale === 'tr') return `${signed} puan`;
  return `${signed} ${Math.abs(delta) === 100 ? 'point' : 'points'}`;
}

// ---- Days ----------------------------------------------------------------------------------

/** A duration: 45 → "45 gün" / "45 days" (en: "1 day"). */
export function formatDays(days: number, locale: Locale): string {
  const n = formatInt(days, locale);
  if (locale === 'tr') return `${n} gün`;
  return `${n} ${Math.abs(days) === 1 ? 'day' : 'days'}`;
}

/** A simulation day: 46 → "Gün 46" / "Day 46". */
export function formatSimDay(day: number, locale: Locale): string {
  return locale === 'tr' ? `Gün ${formatInt(day, locale)}` : `Day ${formatInt(day, locale)}`;
}

/** Direction marker for a change: ▲ up, ▼ down, nothing for zero. */
export function trendMark(delta: number | null): string {
  if (delta === null || delta === 0) return '';
  return delta > 0 ? '▲' : '▼';
}

// ---- Calendar dates (imported companies: Day 1 = the snapshot date) -------------------------

const MONTHS: Record<Locale, readonly string[]> = {
  tr: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

/** Year, month (1–12) and day of an ISO date (`YYYY-MM-DD`, optionally followed by a time); null when it is not one. */
export function isoDateParts(iso: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(iso);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year: Number(m[1]), month, day };
}

/** Name of a month (1–12): "Ocak" / "January". */
export function monthName(month: number, locale: Locale): string {
  return MONTHS[locale][month - 1] ?? String(month);
}

/** A calendar date in words: "2027-01-04" → "4 Ocak 2027" (tr) / "4 January 2027" (en). Not a date: as it is. */
export function formatDate(iso: string, locale: Locale): string {
  const p = isoDateParts(iso);
  return p ? `${p.day} ${monthName(p.month, locale)} ${p.year}` : iso;
}

/** A calendar date in figures: "04.01.2027" (tr) / "04/01/2027" (en, day first). Not a date: as it is. */
export function formatDateShort(iso: string, locale: Locale): string {
  const p = isoDateParts(iso);
  if (!p) return iso;
  const sep = locale === 'tr' ? '.' : '/';
  return `${String(p.day).padStart(2, '0')}${sep}${String(p.month).padStart(2, '0')}${sep}${p.year}`;
}

/** Month and year of a date: "Ocak 2027" / "January 2027". */
export function formatMonthYear(iso: string, locale: Locale): string {
  const p = isoDateParts(iso);
  return p ? `${monthName(p.month, locale)} ${p.year}` : iso;
}
