/** Cell parsing (exact decimals, dates, booleans), the privacy detectors and the template export layout. */
import { describe, expect, it } from 'vitest';
import { loadSeed } from '@ceo-room/seed-data';
import { TEMPLATE, TEMPLATE_MARKER, TEMPLATE_VERSION, columnLetter, exportTemplate, isIban, isPersonalHeader, isTckn, isoToExcelSerial, parseBoolCell, parseDateCell, privacyHits } from './index';
import { parseDecimal, scaleDecimal } from './workbook';

const kurus = (c: string | number): number | null => {
  const d = parseDecimal(c);
  return d ? (scaleDecimal(d, 2)?.value ?? null) : null;
};

describe('decimals are scaled exactly (no float money)', () => {
  it('TRY → kuruş with banker’s rounding beyond 2 decimals', () => {
    expect(kurus(1250.5)).toBe(125050);
    expect(kurus(0.1 + 0.2)).toBe(30); // 0.30000000000000004 → 30
    expect(kurus('1250,50')).toBe(125050);
    expect(kurus('48 500 000')).toBe(4850000000);
    expect(kurus(1.005)).toBe(100); // half to even
    expect(kurus(1.015)).toBe(102);
    expect(kurus('1.0151')).toBe(102);
    expect(kurus(-12.345)).toBe(-1234);
    expect(kurus(1e-7)).toBe(0);
    expect(kurus('1.234.567')).toBeNull();
    expect(kurus('12a')).toBeNull();
    expect(kurus(Number.NaN)).toBeNull();
  });
});

describe('dates and booleans', () => {
  it('reads ISO, DD.MM.YYYY and Excel serials; rejects impossible dates', () => {
    expect(parseDateCell('2027-01-31')).toBe('2027-01-31');
    expect(parseDateCell('2027-01-31T00:00:00Z')).toBe('2027-01-31');
    expect(parseDateCell('5.2.2027')).toBe('2027-02-05');
    expect(parseDateCell(46418)).toBe('2027-01-31');
    expect(parseDateCell(46418.75)).toBe('2027-01-31');
    expect(isoToExcelSerial('2027-01-31')).toBe(46418);
    expect(parseDateCell(isoToExcelSerial('1900-02-28'))).toBe('1900-02-28');
    for (const bad of ['2027-02-29', '31/01/2027', 'yarın', 0, true]) expect(parseDateCell(bad), String(bad)).toBeNull();
  });

  it('reads TRUE/FALSE in English and Turkish', () => {
    for (const t of [true, 'TRUE', 'true', 'EVET', 'Evet', 'DOĞRU', 1]) expect(parseBoolCell(t), String(t)).toBe(true);
    for (const f of [false, 'FALSE', 'HAYIR', 'hayır', 'YANLIŞ', 0]) expect(parseBoolCell(f), String(f)).toBe(false);
    expect(parseBoolCell('belki')).toBeNull();
  });

  it('names columns as Excel does', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
});

describe('privacy detectors', () => {
  it('TCKN and IBAN need valid check digits', () => {
    expect(isTckn('12345678950')).toBe(true);
    expect(isTckn('12345678951')).toBe(false);
    expect(isTckn('02345678950')).toBe(false);
    expect(isIban('TR330006100519786457841326')).toBe(true);
    expect(isIban('TR330006100519786457841327')).toBe(false);
  });

  it('finds personal data in text, not in figures', () => {
    expect(privacyHits('Ayşe 12345678950', false)).toEqual(['tckn']);
    expect(privacyHits('ayse.kaya@firma.com.tr', false)).toEqual(['email']);
    expect(privacyHits('IBAN TR33 0006 1005 1978 6457 8413 26', false)).toEqual(['iban']);
    expect(privacyHits('Tel: (0212) 555 12 34', false)).toEqual(['phone']);
    expect(privacyHits('5321234567', false)).toEqual(['phone']);
    expect(privacyHits('+44 20 7946 0958', false)).toEqual(['phone']);
    expect(privacyHits(12345678950, false)).toEqual(['tckn']);
    expect(privacyHits(12345678950, true)).toEqual([]);
    expect(privacyHits('5 321 234 567', true)).toEqual([]);
    for (const ok of ['2027-01-31', 'C-0012', 'ord-0001', 'Anadolu Raylı A.Ş.', 'PO 2027/0042', '48 500 000', 'Konya OSB 3. Cadde No: 12']) {
      expect(privacyHits(ok, false), ok).toEqual([]);
    }
  });

  it('flags personal-data headers', () => {
    for (const h of ['TCKN', 'tc_kimlik_no', 'E-posta', 'email', 'Telefon', 'GSM', 'IBAN', 'birth_date', 'Doğum Tarihi', 'employee_name', 'Ad Soyad', 'maaş', 'adres']) {
      expect(isPersonalHeader(h), h).toBe(true);
    }
    for (const h of ['name', 'customer_name', 'headcount', 'notes', 'amount']) expect(isPersonalHeader(h), h).toBe(false);
  });
});

describe('template export layout', () => {
  const seed = loadSeed();
  it('README carries the marker and version in A1:B1; each sheet has keys, labels and units', () => {
    const wb = exportTemplate(seed, { lang: 'tr', example: false });
    expect(wb.README?.[0]).toEqual([TEMPLATE_MARKER, TEMPLATE_VERSION]);
    expect(Object.keys(wb)).toEqual(['README', ...TEMPLATE.sheets.map((s) => s.name)]);
    for (const s of TEMPLATE.sheets) {
      expect(wb[s.name]).toHaveLength(3);
      expect(wb[s.name]?.[0]).toEqual(s.columns.map((c) => c.key));
    }
    expect(wb.Settings?.[1]?.[0]).toBe('Şirket adı (Z)');
    expect(wb.Settings?.[2]?.[4]).toBe('TL/saat');
    expect(exportTemplate(seed, { lang: 'en', example: false }).Settings?.[1]?.[0]).toBe('Company name (R)');
  });

  it('the example is NOVARA with figures in template units', () => {
    const wb = exportTemplate(seed, { lang: 'en', example: true });
    expect(wb.Settings?.[3]?.slice(0, 5)).toEqual(['NOVARA Industries', '2027-01-04', 'TRY', 'Bursa', 3600]);
    expect(wb.Customers?.[3]?.slice(0, 4)).toEqual(['cus_demirhan', 'Demirhan Raylı Sistemler A.Ş.', 'TR', 'rail']);
    expect(wb.Cash?.[3]).toEqual(['Cash and banks', 41200000]);
    expect(wb.Products?.[3]).toEqual(['frames', 'machine frames', 24000, 40]);
  });
});
