/** The tr and en catalogues hold every import code with exactly its params, and nothing else under import.*. */
import { describe, expect, it } from 'vitest';
import { CATALOGS, FORMATS, placeholders } from '@ceo-room/i18n';
import { loadSeed } from '@ceo-room/seed-data';
import { exportTemplate, listImportCodes, reportRows, validateWorkbook } from './index';
import { realCompany, setCell } from '../test/fixtures';

const specs = listImportCodes();

describe.each(['tr', 'en'] as const)('%s catalogue', (locale) => {
  const cat = CATALOGS[locale];

  it('translates every import code', () => {
    expect(specs.filter((s) => cat[s.code] === undefined).map((s) => s.code)).toEqual([]);
  });

  it('has no import.* key the package does not use', () => {
    const codes = new Set(specs.map((s) => s.code));
    expect(Object.keys(cat).filter((k) => k.startsWith('import.') && !codes.has(k))).toEqual([]);
  });

  it('uses exactly the params each issue sends, with known formats', () => {
    const bad: string[] = [];
    for (const s of specs) {
      const ph = placeholders(cat[s.code] ?? '');
      if ([...ph.keys()].sort().join() !== [...s.params].sort().join()) bad.push(`${s.code}: {${[...ph.keys()].join()}} vs ${s.params.join()}`);
      for (const f of ph.values()) if (f !== undefined && !(FORMATS as readonly string[]).includes(f)) bad.push(`${s.code}: format ${f}`);
    }
    expect(bad).toEqual([]);
  });

  it('renders the template and a report without raw codes or placeholders', () => {
    const wb = exportTemplate(loadSeed(), { lang: locale, example: true });
    for (const rows of Object.values(wb)) for (const row of rows) for (const c of row) if (typeof c === 'string') expect(c).not.toMatch(/^import\.|[{}]/);
    const broken = setCell(realCompany(), 'Customers', 4, 'country', 'Turkey');
    const rows = reportRows(validateWorkbook(broken), locale);
    expect(rows.length).toBeGreaterThan(2);
    for (const row of rows.slice(1)) expect(String(row[3])).not.toMatch(/^import\.|[{}]|undefined|NaN/);
    expect(rows.find((r) => r[2] === 'import.field.notCountry')?.[1]).toBe('Customers!C4');
  });
});
