/** How the card-index tables print a value of the imported data (engine units → i18n formats). */
import { dateToSimDay } from '@ceo-room/engine';
import { type Translator, formatBps, formatDateShort, formatDecimal, formatInt, formatSimDay } from '@ceo-room/i18n';
import type { Value } from '@ceo-room/import';
import type { BrowseBook, BrowseColumn } from './protocol';

/** Right-aligned (figures) columns. */
export const isFigure = (c: BrowseColumn): boolean => c.type === 'int' || c.type === 'money' || c.type === 'percent' || c.type === 'score';

/**
 * A cell as printed: money in full lira and kuruş, percentages, scores, whole numbers grouped,
 * dates as real dates (My company) or day numbers (the sample, which has no calendar).
 */
export function cellText(t: Translator, col: BrowseColumn, v: Value, book: Pick<BrowseBook, 'company' | 'snapshotDate'>): string {
  if (v === null || v === undefined || v === '') return t.t('ui.figure.none');
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return t.t(v ? 'ui.archive.value.yes' : 'ui.archive.value.no');
  if (typeof v === 'number') {
    switch (col.type) {
      case 'money':
        return t.moneyFull(v);
      case 'percent':
        return formatBps(v, t.locale, 'auto');
      case 'score':
        return formatDecimal(v / 100, t.locale, 2, true);
      default:
        return formatInt(v, t.locale);
    }
  }
  if (col.type === 'date') {
    if (book.company === 'sample' && book.snapshotDate) {
      try {
        return formatSimDay(dateToSimDay(book.snapshotDate, v), t.locale);
      } catch {
        return v;
      }
    }
    return formatDateShort(v, t.locale);
  }
  return v;
}
