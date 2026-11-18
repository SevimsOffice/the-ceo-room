/**
 * Purity guard (CLAUDE.md determinism rules), extending the smoke test: engine source has no clock,
 * randomness, I/O, network, UI, globals or `any`, and imports nothing outside packages/engine/src.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = import.meta.dirname;
const ENGINE = resolve(SRC, '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Remove comments so documentation may mention what code may not do. */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const BANNED: [string, RegExp][] = [
  ['Math.random', /Math\s*\.\s*random|Math\s*\[\s*['"]random/],
  ['Date', /\bDate\b/],
  ['performance', /\bperformance\b/],
  ['timers', /\b(setTimeout|setInterval|setImmediate|queueMicrotask|requestAnimationFrame)\b/],
  ['process', /\bprocess\s*\./],
  ['globalThis/window/document', /\b(globalThis|window|document|navigator)\b\s*[.[]/],
  ['storage', /\b(localStorage|sessionStorage|indexedDB)\b/],
  ['network', /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|\bnew\s+(XMLHttpRequest|WebSocket|EventSource)\b/],
  ['crypto', /\bcrypto\s*\./],
  ['console', /\bconsole\s*\./],
  ['require / dynamic import', /\brequire\s*\(|\bimport\s*\(/],
  ['eval', /\beval\s*\(|\bnew\s+Function\s*\(/],
  ['any', /:\s*any\b|\bas\s+any\b|<any>|any\[\]/],
];

describe('engine purity', () => {
  const files = sources(SRC);

  it('scans the engine sources', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith('core.ts'))).toBe(true);
  });

  it('has no .tsx/.jsx (no React) and no JavaScript sources', () => {
    expect(files.filter((f) => !f.endsWith('.ts')).map((f) => relative(ENGINE, f))).toEqual([]);
  });

  it('uses no clock, randomness, I/O, network, timers, globals, eval or `any`', () => {
    const hits: string[] = [];
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'));
      for (const [name, re] of BANNED) if (re.test(code)) hits.push(`${relative(ENGINE, f)}: ${name}`);
    }
    expect(hits).toEqual([]);
  });

  it('imports only relative modules inside packages/engine/src (no node:, react, fs, LLM SDKs, other packages)', () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g)) {
        const spec = m[1] ?? m[2] ?? '';
        if (!spec.startsWith('./') && !spec.startsWith('../')) {
          bad.push(`${relative(ENGINE, f)} → ${spec}`);
          continue;
        }
        const target = resolve(dirname(f), spec);
        if (relative(SRC, target).startsWith('..')) bad.push(`${relative(ENGINE, f)} → ${spec} (outside src)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('compiles without Node or DOM types', () => {
    const ts = JSON.parse(readFileSync(join(ENGINE, 'tsconfig.json'), 'utf8')) as { compilerOptions?: { types?: string[]; lib?: string[] } };
    expect(ts.compilerOptions?.types).toEqual([]);
    const base = JSON.parse(readFileSync(join(ENGINE, '..', '..', 'tsconfig.base.json'), 'utf8')) as { compilerOptions?: { lib?: string[] } };
    const libs = [...(ts.compilerOptions?.lib ?? []), ...(base.compilerOptions?.lib ?? [])].map((l) => l.toLowerCase());
    expect(libs.some((l) => l.startsWith('dom'))).toBe(false);
  });

  it('the guard itself catches violations', () => {
    const probe = (code: string): string[] => BANNED.filter(([, re]) => re.test(stripComments(code))).map(([n]) => n);
    expect(probe('const x = Math.random();')).toEqual(['Math.random']);
    expect(probe('const t = Date.now();')).toEqual(['Date']);
    expect(probe('await fetch(url)')).toEqual(['network']);
    expect(probe('let v: any = 1;')).toEqual(['any']);
    expect(probe('// Date.now() is banned\nconst ok = 1;')).toEqual([]);
    expect(probe('const company = 1; // no Dates or Maps in state')).toEqual([]);
  });
});
