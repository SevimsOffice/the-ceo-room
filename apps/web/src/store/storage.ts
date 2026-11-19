/** localStorage access that never throws (private mode, quota, disabled storage). */
import type { SaveGame } from '@ceo-room/engine';
import type { Locale } from '@ceo-room/i18n';

export const SAVE_KEY = 'ceo-room.save.v1';
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

export function loadSave(): SaveGame | null {
  const raw = read(SAVE_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as SaveGame;
    return v && typeof v === 'object' && Array.isArray(v.log) ? v : null;
  } catch {
    return null;
  }
}

export function storeSave(save: SaveGame | null): void {
  write(SAVE_KEY, save === null ? null : JSON.stringify(save));
}

export function loadLocale(): Locale {
  const v = read(LOCALE_KEY);
  return v === 'en' || v === 'tr' ? v : 'tr';
}

export function storeLocale(locale: Locale): void {
  write(LOCALE_KEY, locale);
}
