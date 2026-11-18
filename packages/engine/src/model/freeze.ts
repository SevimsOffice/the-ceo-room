/**
 * Deep-freeze a plain JSON value in place and return it. Committed states, ledger events and memoised
 * read models are frozen so a caller cannot change engine-owned figures or poison a cache (any write
 * throws in strict mode). Already-frozen subtrees are skipped: committed states never share objects.
 */
export function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
  }
  return x;
}
