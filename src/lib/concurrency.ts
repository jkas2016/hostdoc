/**
 * Run `fn` over `items` with at most `limit` concurrent invocations.
 * Results keep input order. On the first rejection, no new tasks are
 * scheduled and the returned promise rejects with that error (in-flight
 * tasks settle but their results are ignored).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) return results;
  const workers = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  let failed = false;

  async function worker(): Promise<void> {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
