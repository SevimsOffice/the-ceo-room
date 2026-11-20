/**
 * Privacy guard: the template holds company records and department totals only. Values that look like
 * a Turkish ID number (TCKN, checksum-verified), an IBAN (mod-97 verified), an e-mail address or a
 * phone number are rejected wherever they appear in text; columns that hold person-level data are
 * rejected (any extra column in Workforce, a personal-data header anywhere).
 */
import type { Cell } from './workbook';

export type PrivacyHit = 'tckn' | 'iban' | 'email' | 'phone';

/** TCKN: 11 digits, first non-zero, two check digits. */
export function isTckn(digits: string): boolean {
  if (!/^[1-9]\d{10}$/.test(digits)) return false;
  const d = [...digits].map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  if (d10 !== d[9]) return false;
  return d.slice(0, 10).reduce((t, x) => t + x, 0) % 10 === d[10];
}

/** IBAN: country code, 2 check digits, 11–30 alphanumerics, ISO 7064 mod 97 = 1. */
export function isIban(compact: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  const moved = compact.slice(4) + compact.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of v) rem = (rem * 10 + Number(digit)) % 97;
  }
  return rem === 1;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
/** Where an IBAN may start: two letters and two check digits, not inside a longer word. */
const IBAN_START = /(?<![A-Za-z0-9])[A-Za-z]{2}\d{2}/g;
/** IBAN lengths by country where it matters (Turkey: 26); others 15–34. */
const IBAN_LENGTH: Readonly<Record<string, number>> = { TR: 26, DE: 22, GB: 22, FR: 27, NL: 18, IT: 27, ES: 24, AT: 20, BE: 16, CH: 21 };

/**
 * An IBAN anywhere in a text, written compact or in groups (`TR33 0006 1005 …`), followed by anything
 * (`… 26 Ziraat`, `…26 TL`, `…26 hesabına`). From each possible start the following letters and digits
 * (single spaces between groups) are tried at the country's length, or 15–34 for other countries,
 * where a group ends; the mod-97 check keeps chance matches out.
 */
function hasIban(text: string): boolean {
  for (const m of text.matchAll(IBAN_START)) {
    let compact = '';
    const ends = new Set<number>();
    for (let i = m.index; i < text.length && compact.length < 34; i++) {
      const ch = text[i]!;
      if (/[A-Za-z0-9]/.test(ch)) {
        compact += ch.toUpperCase();
        const next = text[i + 1];
        if (next === undefined || !/[A-Za-z0-9]/.test(next)) ends.add(compact.length);
      } else if (ch === ' ' && /[A-Za-z0-9]/.test(text[i + 1] ?? '') && compact.length > 0) {
        continue;
      } else break;
    }
    const country = compact.slice(0, 2);
    const fixed = IBAN_LENGTH[country];
    for (const len of ends) {
      if (fixed !== undefined ? len !== fixed : len < 15 || len > 34) continue;
      if (isIban(compact.slice(0, len))) return true;
    }
  }
  return false;
}

/**
 * Digit runs: digits and the separators people put inside phone numbers (single spaces, dots, dashes,
 * slashes, brackets). Two or more spaces, or anything else, end a run.
 */
const DIGIT_RUN = /\+?\d(?:[\d().\-/]| (?! ))*\d/g;

/**
 * Phone numbers: international (+ or 00, then 10–14 digits); Turkish with the trunk 0 (0 then 10
 * digits, area code 2xx–5xx); mobile without it (5xx + 7 digits); landline without it (2xx–4xx + 7
 * digits) only when grouped like a phone number (`212 555 12 12`, `(212) 555 1212`), so a plain
 * 10-digit code or a run of account-number groups is not a phone.
 */
function looksLikePhone(run: string): boolean {
  const digits = run.replace(/\D/g, '');
  if (/^\+/.test(run.trim()) || /^00/.test(digits)) return digits.replace(/^00/, '').length >= 10 && digits.length <= 15;
  if (/^0[2-5]\d{9}$/.test(digits)) return true;
  if (/^5\d{9}$/.test(digits)) return true;
  if (/^[2-4]\d{9}$/.test(digits) && LANDLINE_LAYOUTS.has(groupLayout(run))) return true;
  return false;
}

/** Digit-group lengths of a run (`212 555 12 12` → `3-3-2-2`). */
const groupLayout = (run: string): string =>
  run
    .split(/[^\d]+/)
    .filter((g) => g.length > 0)
    .map((g) => g.length)
    .join('-');

/** How a Turkish landline is written without its trunk 0 (area code, then 7 digits). */
const LANDLINE_LAYOUTS = new Set(['3-3-2-2', '3-3-4', '3-7']);

/**
 * A phone number inside a digit run: the whole run, or any window of its groups holding 10–11
 * digits (`Sipariş 12 05321234567`: the second group alone is a mobile number).
 */
function runHasPhone(run: string): boolean {
  if (looksLikePhone(run)) return true;
  const groups = run.split(/[ .\-/()]+/).filter((g) => g.length > 0);
  for (let a = 0; a < groups.length; a++) {
    let digits = 0;
    for (let b = a; b < groups.length; b++) {
      digits += groups[b]!.replace(/\D/g, '').length;
      if (digits > 11) break;
      if ((a > 0 || b < groups.length - 1) && digits >= 10 && looksLikePhone(groups.slice(a, b + 1).join(' '))) return true;
    }
  }
  return false;
}

/**
 * Personal data in one cell. `numericColumn` cells (money, quantities, dates) are only checked for
 * e-mail and IBAN text: a long number there is a figure, not an ID or a phone number.
 */
export function privacyHits(c: Cell, numericColumn: boolean): PrivacyHit[] {
  const out: PrivacyHit[] = [];
  if (typeof c === 'number') {
    if (!numericColumn && Number.isSafeInteger(c) && isTckn(String(c))) out.push('tckn');
    return out;
  }
  if (typeof c !== 'string') return out;
  if (EMAIL.test(c)) out.push('email');
  if (hasIban(c)) out.push('iban');
  if (numericColumn) return out;
  let tckn = false;
  let phone = false;
  for (const m of c.matchAll(DIGIT_RUN)) {
    const run = m[0];
    const digits = run.replace(/\D/g, '');
    if (!tckn && /^\d{11}$/.test(run.trim()) && isTckn(digits)) tckn = true;
    else if (!phone && runHasPhone(run)) phone = true;
  }
  for (const m of c.matchAll(/\d{11}/g)) if (!tckn && isTckn(m[0])) tckn = true;
  if (tckn) out.push('tckn');
  if (phone) out.push('phone');
  return out;
}

/**
 * Column headers that name personal data, matched on the header folded to lower-case ASCII with
 * separators as `_` (`Ad Soyad` → `ad_soyad`, `KİŞİ` → `kisi`, `Maaş` → `maas`). Template columns
 * are matched before this is asked (Customers.name and Suppliers.name are company names).
 */
const PERSONAL_HEADER =
  /(^|_)(tckn|tc|tc_?kimlik(_?no)?|kimlik(_?no)?|national_?id|ssn|e_?mail|e_?posta|mail|phone|telefon|tel|gsm|mobile|cep|iban|birth(_?date)?|dogum(_?tarihi)?|address|adres|salary|salaries|wage|maas|ucret_?bordro|bordro|ad|adi|soyad|soyadi|ad_?soyad|adsoyad|isim|soyisim|isim_?soyisim|name_?surname|surname|first_?name|last_?name|full_?name|person|kisi|yetkili|contact|contact_?person|contact_?name|employee(_?(id|name|no))?|personel(_?(id|no|adi))?|calisan|sicil(_?no)?)($|_)/;

const FOLD: Readonly<Record<string, string>> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

export function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s\-./]+/g, '_');
}

/** Lower-case ASCII with `_` separators, Turkish letters folded (İ → i, ş → s, …). */
export function foldHeader(h: string): string {
  return h
    .trim()
    .replace(/İ/g, 'i')
    .toLowerCase()
    .replace(/\u0307/g, '')
    .replace(/[çğıöşüâîû]/g, (ch) => FOLD[ch] ?? ch)
    .replace(/[\s\-./]+/g, '_');
}

export function isPersonalHeader(h: string): boolean {
  return PERSONAL_HEADER.test(foldHeader(h));
}
