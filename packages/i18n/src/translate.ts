import {
  type Locale,
  formatBps,
  formatBpsPoints,
  formatDate,
  formatDateShort,
  formatDays,
  formatInt,
  formatMoney,
  formatMoneyFull,
  formatScore,
  formatScoreDelta,
  formatSignedBps,
  formatSignedInt,
  formatSignedMoney,
  formatSimDay,
} from './format';
import { en } from './catalog/en';
import { tr } from './catalog/tr';

export type Catalog = Readonly<Record<string, string>>;
export type ParamValue = string | number | boolean | null;
export type Params = Readonly<Record<string, ParamValue>>;

/** A message as the engine emits it: an i18n code and its params. */
export interface Message {
  code: string;
  params: Params;
}

/**
 * Names of the company's records, for params that carry an id. Proper names (customers,
 * suppliers, plants) are printed as they are; the others are i18n keys.
 */
export interface Directory {
  customers: Readonly<Record<string, string>>;
  suppliers: Readonly<Record<string, string>>;
  plants: Readonly<Record<string, string>>;
  /** material id → nameKey */
  materials: Readonly<Record<string, string>>;
  /** product family id → nameKey */
  families: Readonly<Record<string, string>>;
  /** line id → kindKey + plant */
  lines: Readonly<Record<string, { kindKey: string; plantId: string }>>;
}

export const EMPTY_DIRECTORY: Directory = { customers: {}, suppliers: {}, plants: {}, materials: {}, families: {}, lines: {} };

export const CATALOGS: Readonly<Record<Locale, Catalog>> = { tr, en };

/**
 * Placeholder syntax: `{name}` or `{name:format}`. Formats:
 * money, moneyFull, price (= moneyFull), signedMoney, bps, bps1 (one decimal), signedBps, bpsPoints,
 * score, scoreDelta, int, signedInt, day (Gün 46), days (45 gün), date (4 Ocak 2027, from ISO),
 * dateShort (04.01.2027), customer, supplier, plant,
 * counterparty (customer or supplier), material, family, line, department, code (nested message
 * code), text (as is). Without a format: numbers as grouped integers, strings as they are.
 */
export const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)(?::([A-Za-z0-9]+))?\}/g;

export const FORMATS = [
  'money',
  'moneyFull',
  'price',
  'signedMoney',
  'bps',
  'bps1',
  'signedBps',
  'bpsPoints',
  'score',
  'scoreDelta',
  'int',
  'signedInt',
  'day',
  'days',
  'date',
  'dateShort',
  'customer',
  'supplier',
  'plant',
  'counterparty',
  'material',
  'family',
  'line',
  'department',
  'code',
  'text',
] as const;
export type FormatName = (typeof FORMATS)[number];

/** Placeholders of a template: name → format (undefined when none). */
export function placeholders(template: string): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  for (const m of template.matchAll(PLACEHOLDER)) out.set(m[1]!, m[2]);
  return out;
}

export interface TranslatorOptions {
  currency?: string;
  directory?: Directory;
  /** called for a code missing from the catalogue (default: none) */
  onMissing?: (code: string) => void;
}

export interface Translator {
  locale: Locale;
  /** translate a code with params; unknown codes come back as the code itself */
  t(code: string, params?: Params): string;
  /** translate an engine message */
  msg(m: Message): string;
  /** `${key}.one` when count is 1, else `${key}.other`; `count` is passed as a param */
  plural(key: string, count: number, params?: Params): string;
  has(code: string): boolean;
  /** formatting helpers bound to this locale and currency */
  money(kurus: number): string;
  moneyFull(kurus: number): string;
  currency: string;
}

export function createTranslator(locale: Locale, opts: TranslatorOptions = {}): Translator {
  const catalog = CATALOGS[locale];
  const currency = opts.currency ?? 'TRY';
  const dir = opts.directory ?? EMPTY_DIRECTORY;

  const name = (code: string): string => catalog[code] ?? code;

  const lineName = (id: string): string => {
    const l = dir.lines[id];
    if (!l) return id;
    const plant = dir.plants[l.plantId];
    return plant ? `${plant} ${name(l.kindKey)}` : name(l.kindKey);
  };

  const format = (value: ParamValue, fmt: string | undefined): string => {
    if (value === null || value === undefined) return '';
    const n = typeof value === 'number' ? value : Number.NaN;
    const s = String(value);
    switch (fmt as FormatName | undefined) {
      case 'money':
        return Number.isFinite(n) ? formatMoney(n, locale, currency) : s;
      case 'moneyFull':
      case 'price':
        return Number.isFinite(n) ? formatMoneyFull(n, locale, currency) : s;
      case 'signedMoney':
        return Number.isFinite(n) ? formatSignedMoney(n, locale, currency) : s;
      case 'bps':
        return Number.isFinite(n) ? formatBps(n, locale, 'auto') : s;
      case 'bps1':
        return Number.isFinite(n) ? formatBps(n, locale, 1) : s;
      case 'signedBps':
        return Number.isFinite(n) ? formatSignedBps(n, locale, 'auto') : s;
      case 'bpsPoints':
        return Number.isFinite(n) ? formatBpsPoints(n, locale) : s;
      case 'score':
        return Number.isFinite(n) ? formatScore(n, locale) : s;
      case 'scoreDelta':
        return Number.isFinite(n) ? formatScoreDelta(n, locale) : s;
      case 'int':
        return Number.isFinite(n) ? formatInt(n, locale) : s;
      case 'signedInt':
        return Number.isFinite(n) ? formatSignedInt(n, locale) : s;
      case 'day':
        return Number.isFinite(n) ? formatSimDay(n, locale) : s;
      case 'days':
        return Number.isFinite(n) ? formatDays(n, locale) : s;
      case 'date':
        return formatDate(s, locale);
      case 'dateShort':
        return formatDateShort(s, locale);
      case 'customer':
        return dir.customers[s] ?? s;
      case 'supplier':
        return dir.suppliers[s] ?? s;
      case 'counterparty':
        return dir.customers[s] ?? dir.suppliers[s] ?? s;
      case 'plant':
        return dir.plants[s] ?? s;
      case 'material':
        return dir.materials[s] ? name(dir.materials[s]) : s;
      case 'family':
        return dir.families[s] ? name(dir.families[s]) : s;
      case 'line':
        return lineName(s);
      case 'department':
        return name(`department.${s}`);
      case 'code':
        return name(s);
      case 'text':
        return s;
      default:
        return typeof value === 'number' ? formatInt(value, locale) : s;
    }
  };

  const t = (code: string, params: Params = {}): string => {
    const template = catalog[code];
    if (template === undefined) {
      opts.onMissing?.(code);
      return code;
    }
    return template.replace(PLACEHOLDER, (_m, key: string, fmt: string | undefined) => format(params[key] ?? null, fmt));
  };

  return {
    locale,
    currency,
    t,
    msg: (m) => t(m.code, m.params),
    plural: (key, count, params = {}) => t(count === 1 ? `${key}.one` : `${key}.other`, { ...params, count }),
    has: (code) => catalog[code] !== undefined,
    money: (k) => formatMoney(k, locale, currency),
    moneyFull: (k) => formatMoneyFull(k, locale, currency),
  };
}
