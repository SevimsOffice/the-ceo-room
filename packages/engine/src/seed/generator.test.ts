/**
 * The seed generator (scripts/generate-seed.ts) is deterministic and the committed data/seed files are
 * exactly its output. It runs in-process with node:fs writes captured, so nothing touches disk.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SEED_FILES } from './types';

const captured: Map<string, string>[] = [];
let current = new Map<string, string>();

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn((path: unknown, data: unknown) => {
      current.set(String(path), String(data));
    }),
  };
});

const SEED_DIR = join(import.meta.dirname, '..', '..', '..', '..', 'data', 'seed');

async function generate(): Promise<Map<string, string>> {
  current = new Map();
  vi.resetModules();
  await import('../../../../scripts/generate-seed');
  return current;
}

describe('seed generator', () => {
  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    captured.push(await generate());
    captured.push(await generate());
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('writes one file per seed key into data/seed', () => {
    const first = captured[0];
    if (!first) throw new Error('generator did not run');
    expect([...first.keys()].map((p) => p.replace(/\\/g, '/')).sort()).toEqual(
      SEED_FILES.map((f) => join(SEED_DIR, `${f}.json`).replace(/\\/g, '/')).sort(),
    );
  });

  it('produces byte-identical output on every run', () => {
    expect(captured[0]?.size).toBe(SEED_FILES.length);
    expect([...(captured[1]?.entries() ?? [])]).toEqual([...(captured[0]?.entries() ?? [])]);
  });

  it('matches the committed data/seed files byte for byte', () => {
    for (const f of SEED_FILES) {
      const path = join(SEED_DIR, `${f}.json`);
      expect(captured[0]?.get(path), f).toBe(readFileSync(path, 'utf8'));
    }
  });
});
