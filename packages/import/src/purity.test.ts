/** The import core is pure: no clock, randomness, I/O, DOM or network (same rules as the engine). */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = import.meta.dirname;
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const BANNED: [string, RegExp][] = [
  ['Math.random', /Math\s*\.\s*random/],
  ['Date', /\bDate\b/],
  ['timers', /\b(setTimeout|setInterval|requestAnimationFrame)\b/],
  ['globals', /\b(globalThis|window|document|navigator|process)\b\s*[.[]/],
  ['storage / network', /\b(localStorage|indexedDB|fetch|XMLHttpRequest|WebSocket)\b/],
  ['node / fs', /from\s+['"](node:|fs|path)/],
  ['any', /:\s*any\b|\bas\s+any\b/],
];

describe('import purity', () => {
  it('uses no clock, randomness, I/O, DOM or `any` outside tests', () => {
    const hits: string[] = [];
    for (const f of readdirSync(SRC).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
      const code = strip(readFileSync(join(SRC, f), 'utf8'));
      for (const [name, re] of BANNED) if (re.test(code)) hits.push(`${f}: ${name}`);
    }
    expect(hits).toEqual([]);
  });
});
