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
const IBAN_CANDIDATE = /\b[A-Za-z]{2}\d{2}(?:[ ]?[A-Za-z0-9]){11,30}\b/g;
const DIGIT_RUN = /\+?\d[\d\s().\-/]*\d/g;

/** Phone: international (+ or 00 then 10–14 digits) or Turkish (0 then a 2–5 area code, 10 digits; or 5xx mobile without 0). */
function looksLikePhone(run: string): boolean {
  const digits = run.replace(/\D/g, '');
  if (/^\+/.test(run.trim()) || /^00/.test(digits)) return digits.replace(/^00/, '').length >= 10 && digits.length <= 15;
  if (/^0[2-5]\d{9}$/.test(digits)) return true;
  if (/^5\d{9}$/.test(digits)) return true;
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
  for (const m of c.matchAll(IBAN_CANDIDATE)) {
    if (isIban(m[0].replace(/ /g, '').toUpperCase())) {
      out.push('iban');
      break;
    }
  }
  if (numericColumn) return out;
  let tckn = false;
  let phone = false;
  for (const m of c.matchAll(DIGIT_RUN)) {
    const run = m[0];
    const digits = run.replace(/\D/g, '');
    if (!tckn && /^\d{11}$/.test(run.trim()) && isTckn(digits)) tckn = true;
    else if (!phone && looksLikePhone(run)) phone = true;
  }
  for (const m of c.matchAll(/\d{11}/g)) if (!tckn && isTckn(m[0])) tckn = true;
  if (tckn) out.push('tckn');
  if (phone) out.push('phone');
  return out;
}

/** Column headers that name personal data (normalised: lower case, separators as `_`). */
const PERSONAL_HEADER =
  /(^|_)(tckn|tc_?kimlik|kimlik(_?no)?|national_?id|ssn|e_?mail|e_?posta|mail|phone|telefon|tel|gsm|mobile|cep|iban|birth(_?date)?|dogum|doğum|address|adres|salary|maas|maaş|surname|soyad|soyadi|soyadı|first_?name|last_?name|full_?name|ad_?soyad|employee(_?(id|name|no))?|personel(_?(id|no|adi|adı))?|calisan|çalışan|sicil(_?no)?)($|_)/;

export function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s\-./]+/g, '_');
}

export function isPersonalHeader(h: string): boolean {
  return PERSONAL_HEADER.test(normaliseHeader(h));
}
