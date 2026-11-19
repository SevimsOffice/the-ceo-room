/** localStorage access that never throws (private mode, quota, disabled storage). */
import type { Locale } from '@ceo-room/i18n';
import type { StoredSave } from '../worker/protocol';

export const SAVE_KEY = 'ceo-room.save.v1';
/** Where a save that could not be restored is kept (the last one only), before a new game overwrites it. */
export const BACKUP_KEY = 'ceo-room.save.v1.bak';
export const LOCALE_KEY = 'ceo-room.locale';

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
export function loadSave(): { save: StoredSave | null; unreadable: boolean } {
  const raw = read(SAVE_KEY);
  if (!raw) return { save: null, unreadable: false };
  try {
    const v = JSON.parse(raw) as StoredSave | null;
    if (v && typeof v === 'object' && Array.isArray(v.log)) return { save: v, unreadable: false };
  } catch {
    // fall through
  }
  return { save: null, unreadable: true };
}

export function storeSave(save: StoredSave | null): void {
  write(SAVE_KEY, save === null ? null : JSON.stringify(save));
}

/** Copy the stored save, exactly as stored, to BACKUP_KEY (nothing to copy: the backup is left alone). */
export function backupSave(): void {
  const raw = read(SAVE_KEY);
  if (raw) write(BACKUP_KEY, raw);
}

export function loadBackup(): string | null {
  return read(BACKUP_KEY);
}

export function loadLocale(): Locale {
  const v = read(LOCALE_KEY);
  return v === 'en' || v === 'tr' ? v : 'tr';
}

export function storeLocale(locale: Locale): void {
  write(LOCALE_KEY, locale);
}
