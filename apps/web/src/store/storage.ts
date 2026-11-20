/** localStorage access that never throws (private mode, quota, disabled storage). */
import type { Locale } from '@ceo-room/i18n';
import type { StoredSave } from '../worker/protocol';
import type { CompanyId } from '../archive/protocol';

/** The sample company's save game (the key predates My company and is kept as it was). */
export const SAVE_KEY = 'ceo-room.save.v1';
/** Where a save that could not be restored is kept (the last one only), before a new game overwrites it. */
export const BACKUP_KEY = 'ceo-room.save.v1.bak';
/** My company's save game: separate from the sample's, so switching never mixes the two. */
export const MINE_SAVE_KEY = 'ceo-room.save.mine.v1';
export const MINE_BACKUP_KEY = 'ceo-room.save.mine.v1.bak';
export const LOCALE_KEY = 'ceo-room.locale';
/** Which company is on the desk: 'sample' | 'mine'. */
export const COMPANY_KEY = 'ceo-room.company';

const saveKey = (c: CompanyId): string => (c === 'mine' ? MINE_SAVE_KEY : SAVE_KEY);
const backupKey = (c: CompanyId): string => (c === 'mine' ? MINE_BACKUP_KEY : BACKUP_KEY);

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    // storage unavailable: the game still runs, it just is not remembered
  }
}

/**
 * The stored save game. `unreadable`: something is stored but it is not a save game (bad JSON,
 * wrong shape); the worker then reports a failed restore and the Desk keeps it as a backup.
 */
export function loadSave(company: CompanyId = 'sample'): { save: StoredSave | null; unreadable: boolean } {
  const raw = read(saveKey(company));
  if (!raw) return { save: null, unreadable: false };
  try {
    const v = JSON.parse(raw) as StoredSave | null;
    if (v && typeof v === 'object' && Array.isArray(v.log)) return { save: v, unreadable: false };
  } catch {
    // fall through
  }
  return { save: null, unreadable: true };
}

export function storeSave(save: StoredSave | null, company: CompanyId = 'sample'): void {
  write(saveKey(company), save === null ? null : JSON.stringify(save));
}

/** Copy the stored save, exactly as stored, to its backup key (nothing to copy: the backup is left alone). */
export function backupSave(company: CompanyId = 'sample'): void {
  const raw = read(saveKey(company));
  if (raw) write(backupKey(company), raw);
}

export function loadBackup(company: CompanyId = 'sample'): string | null {
  return read(backupKey(company));
}

/** Forget a company's save game and its backup (My company removed or replaced). */
export function clearSaves(company: CompanyId): void {
  write(saveKey(company), null);
  write(backupKey(company), null);
}

export function loadActiveCompany(): CompanyId {
  return read(COMPANY_KEY) === 'mine' ? 'mine' : 'sample';
}

export function storeActiveCompany(company: CompanyId): void {
  write(COMPANY_KEY, company === 'mine' ? 'mine' : null);
}

export function loadLocale(): Locale {
  const v = read(LOCALE_KEY);
  return v === 'en' || v === 'tr' ? v : 'tr';
}

export function storeLocale(locale: Locale): void {
  write(LOCALE_KEY, locale);
}
