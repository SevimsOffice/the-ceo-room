import { describe, expect, it } from 'vitest';
import { createEngine, listMessageCodes, selectMorningReport } from '@ceo-room/engine';
import { loadSeed } from '@ceo-room/seed-data';
import { CATALOGS, FORMATS, createTranslator, placeholders, type Directory } from './translate';
import type { Locale } from './format';

const seed = loadSeed();
const engine = createEngine(seed, { rngSeed: 42, workspaceId: 'ws_test' });
const specs = listMessageCodes(engine.state());
const LOCALES: Locale[] = ['tr', 'en'];

function directoryOf(): Directory {
  const s = engine.state();
  return {
    customers: Object.fromEntries(s.customers.map((c) => [c.id, c.name])),
    suppliers: Object.fromEntries(s.suppliers.map((c) => [c.id, c.name])),
    plants: Object.fromEntries(s.plants.map((p) => [p.id, p.name])),
    materials: Object.fromEntries(s.materials.map((m) => [m.id, m.nameKey])),
    families: Object.fromEntries(s.productFamilies.map((f) => [f.id, f.nameKey])),
    lines: Object.fromEntries(s.lines.map((l) => [l.id, { kindKey: l.kindKey, plantId: l.plantId }])),
  };
}

describe('catalogue completeness against the engine (listMessageCodes of the seed state)', () => {
  it('lists the codes the Desk needs', () => {
    const codes = new Set(specs.map((s) => s.code));
    for (const c of ['company.name', 'card.largeOrder', 'weekday.mon', 'health.band.good', 'ledger.OrderShipped', 'error.unknownDecision', 'reason.late']) {
      expect(codes.has(c)).toBe(true);
    }
  });

  for (const locale of LOCALES) {
    it(`${locale}: every engine code is translated`, () => {
      const missing = specs.filter((s) => CATALOGS[locale][s.code] === undefined).map((s) => s.code);
      expect(missing).toEqual([]);
    });

    it(`${locale}: placeholders use only the params the engine sends`, () => {
      const bad: string[] = [];
      for (const s of specs) {
        const tpl = CATALOGS[locale][s.code];
        if (tpl === undefined) continue;
        for (const name of placeholders(tpl).keys()) if (!s.params.includes(name)) bad.push(`${s.code}: {${name}}`);
      }
      expect(bad).toEqual([]);
    });

    it(`${locale}: every key that is not ui.* is an engine code`, () => {
      const codes = new Set(specs.map((s) => s.code));
      const extra = Object.keys(CATALOGS[locale]).filter((k) => !k.startsWith('ui.') && !codes.has(k));
      expect(extra).toEqual([]);
    });

    it(`${locale}: only known formats are used`, () => {
      const known = new Set<string>(FORMATS);
      const bad: string[] = [];
      for (const [k, tpl] of Object.entries(CATALOGS[locale])) {
        for (const [name, fmt] of placeholders(tpl)) if (fmt !== undefined && !known.has(fmt)) bad.push(`${k}: {${name}:${fmt}}`);
      }
      expect(bad).toEqual([]);
    });
  }

  it('engine codes carrying params use the same placeholders in tr and en', () => {
    const bad: string[] = [];
    for (const s of specs) {
      const a = [...placeholders(CATALOGS.tr[s.code] ?? '').keys()].sort();
      const b = [...placeholders(CATALOGS.en[s.code] ?? '').keys()].sort();
      if (a.join() !== b.join()) bad.push(`${s.code}: tr {${a.join()}} en {${b.join()}}`);
    }
    expect(bad).toEqual([]);
  });

  it('telegram params are all shown (no figure dropped from a telegram)', () => {
    for (const s of specs.filter((x) => x.kind === 'card')) {
      for (const locale of LOCALES) {
        expect([...placeholders(CATALOGS[locale][s.code]!).keys()].sort(), `${locale} ${s.code}`).toEqual([...s.params].sort());
      }
    }
  });
});

describe('tr and en have the same keys', () => {
  it('no key missing on either side', () => {
    const tr = new Set(Object.keys(CATALOGS.tr));
    const en = new Set(Object.keys(CATALOGS.en));
    expect([...tr].filter((k) => !en.has(k))).toEqual([]);
    expect([...en].filter((k) => !tr.has(k))).toEqual([]);
  });

  it('every key has the same placeholders (names and formats) in both', () => {
    const bad: string[] = [];
    for (const k of Object.keys(CATALOGS.en)) {
      const a = [...placeholders(CATALOGS.en[k]!)].map(([n, f]) => `${n}:${f ?? ''}`).sort().join();
      const b = [...placeholders(CATALOGS.tr[k] ?? '')].map(([n, f]) => `${n}:${f ?? ''}`).sort().join();
      if (a !== b) bad.push(`${k}: en {${a}} tr {${b}}`);
    }
    expect(bad).toEqual([]);
  });

  it('plural keys come in .one / .other pairs', () => {
    for (const locale of LOCALES) {
      const keys = Object.keys(CATALOGS[locale]);
      for (const k of keys.filter((x) => x.endsWith('.one'))) expect(keys).toContain(k.replace(/\.one$/, '.other'));
      for (const k of keys.filter((x) => x.endsWith('.other'))) expect(keys).toContain(k.replace(/\.other$/, '.one'));
    }
  });
});

describe('everything the engine emits in 60 days renders cleanly', () => {
  const e = createEngine(seed, { rngSeed: 42, workspaceId: 'ws_test' });
  e.advance(60);
  const reports = [selectMorningReport(e.state(), { includeRunway: false })];
  const directory = directoryOf();

  for (const locale of LOCALES) {
    it(`${locale}: ledger lines and telegrams have no missing code or unfilled placeholder`, () => {
      const missing: string[] = [];
      const tr = createTranslator(locale, { directory, onMissing: (c) => missing.push(c) });
      const lines = e.ledger().map((ev) => tr.t(ev.code, ev.params as Record<string, string | number | boolean | null>));
      const telegrams = reports.flatMap((r) => r.telegrams.map((t) => tr.msg(t.message as never)));
      for (const line of [...lines, ...telegrams]) {
        expect(line).not.toMatch(/[{}]/);
        expect(line).not.toMatch(/undefined|NaN|cus_|sup_|plant_/);
      }
      expect([...new Set(missing)]).toEqual([]);
    });
  }

  it('the company name is localised', () => {
    expect(createTranslator('en').t('company.name')).toBe('NOVARA Industries');
    expect(createTranslator('tr').t('company.name')).toBe('NOVARA Sanayi');
  });
});
