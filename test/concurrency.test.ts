import { describe, it, expect } from "vitest";
import { mapLimit } from "../src/lib/concurrency.js";

describe("mapLimit", () => {
  it("returns [] for empty input", async () => {
    const out = await mapLimit([], 4, async () => 1);
    expect(out).toEqual([]);
  });

  it("preserves result order regardless of completion order", async () => {
    const items = [30, 10, 20];
    const out = await mapLimit(items, 3, async (n) => {
      await new Promise((r) => setTimeout(r, n));
      return n * 2;
    });
    expect(out).toEqual([60, 20, 40]);
  });

  it("passes the index to fn", async () => {
    const out = await mapLimit(["a", "b", "c"], 2, async (item, i) => `${i}:${item}`);
    expect(out).toEqual(["0:a", "1:b", "2:c"]);
  });

  it("never exceeds the concurrency limit but does run in parallel", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapLimit(items, 4, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("propagates the first rejection", async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });

  it("stops scheduling after a rejection (serial limit)", async () => {
    const seen: number[] = [];
    await expect(
      mapLimit([0, 1, 2], 1, async (n) => {
        seen.push(n);
        if (n === 0) throw new Error("stop");
        return n;
      }),
    ).rejects.toThrow("stop");
    expect(seen).toEqual([0]);
  });

  it("handles limit >= length", async () => {
    const out = await mapLimit([1, 2, 3], 100, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30]);
  });

  it("treats limit <= 0 as serial (no hang)", async () => {
    const out = await mapLimit([1, 2], 0, async (n) => n);
    expect(out).toEqual([1, 2]);
  });
});
