import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { closePool, pool } from "@/server/db";
import { requestBook } from "@/server/domain/exchanges/request";
import { adminAdjust } from "@/server/domain/credits";
import { searchListings } from "@/server/domain/listings";
import { cached } from "@/server/cache";
import { fetchJson, UpstreamError } from "@/server/http";
import { lookupIsbn } from "@/server/domain/catalog";
import { adminUser, balance, makeListing, makeUser, resetData } from "./helpers";

beforeEach(resetData);
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CATALOG_LOOKUP;
});
afterAll(closePool);

describe("idempotency keys", () => {
  it("replay the same request, but refuse the same key for a different request", async () => {
    const sender = await makeUser();
    const req = await makeUser({ credits: 3 });
    const [a, b] = [await makeListing(sender.id), await makeListing(sender.id)];
    const k = randomUUID();
    const first = await requestBook({ requesterId: req.id, listingId: a, addressId: req.addressId, requestKey: k });
    expect(await requestBook({ requesterId: req.id, listingId: a, addressId: req.addressId, requestKey: k })).toBe(
      first,
    );
    await expect(
      requestBook({ requesterId: req.id, listingId: b, addressId: req.addressId, requestKey: k }),
    ).rejects.toThrow(/different request/);
    expect(await balance(req.id)).toEqual({ available: 2, reserved: 1 });
  });

  it("refuse a ledger key reused with a different amount", async () => {
    const admin = await adminUser();
    const m = await makeUser();
    await adminAdjust({ adminId: admin, userId: m.id, amount: 1, reason: "Goodwill credit", idempotencyKey: "k-1" });
    await expect(
      adminAdjust({ adminId: admin, userId: m.id, amount: 5, reason: "Goodwill credit", idempotencyKey: "k-1" }),
    ).rejects.toThrow(/different credit change/);
    expect(await balance(m.id)).toEqual({ available: 1, reserved: 0 });
  });
});

describe("cursor pagination", () => {
  it("walks every listing exactly once even when new listings arrive between pages", async () => {
    const owner = await makeUser();
    for (let i = 0; i < 7; i++) await makeListing(owner.id, { title: `Book ${i}` });
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof searchListings>> = await searchListings({ limit: 3, cursor });
      seen.push(...page.rows.map((r) => r.id));
      cursor = page.nextCursor;
      if (pages++ === 0) await makeListing(owner.id, { title: "Arrived mid-browse" }); // newer: sorts before the cursor
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("supports title order and ignores a tampered cursor", async () => {
    const owner = await makeUser();
    for (const t of ["Cedar", "Apple", "Birch", "Delta"]) await makeListing(owner.id, { title: t });
    const p1 = await searchListings({ sort: "title", limit: 2 });
    const p2 = await searchListings({ sort: "title", limit: 2, cursor: p1.nextCursor });
    expect([...p1.rows, ...p2.rows].map((r) => r.title)).toEqual(["Apple", "Birch", "Cedar", "Delta"]);
    expect(p2.nextCursor).toBeNull();
    const bad = await searchListings({ sort: "title", limit: 2, cursor: "not-a-cursor" });
    expect(bad.rows.map((r) => r.title)).toEqual(["Apple", "Birch"]);
  });
});

describe("cache-aside", () => {
  const policy = { name: "test", ttlSeconds: 60, jitterSeconds: 5, negativeTtlSeconds: 10 };

  it("serves hits, coalesces concurrent misses and caches not-found briefly", async () => {
    let calls = 0;
    const compute = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return { v: 1 };
    };
    const results = await Promise.all([
      cached(policy, "test:v1:a", compute),
      cached(policy, "test:v1:a", compute),
      cached(policy, "test:v1:a", compute),
    ]);
    expect(results).toEqual([{ v: 1 }, { v: 1 }, { v: 1 }]);
    expect(calls).toBe(1); // single-flight
    expect(await cached(policy, "test:v1:a", compute)).toEqual({ v: 1 });
    expect(calls).toBe(1);

    let missCalls = 0;
    await cached(policy, "test:v1:missing", async () => {
      missCalls++;
      return null;
    });
    await cached(policy, "test:v1:missing", async () => {
      missCalls++;
      return null;
    });
    expect(missCalls).toBe(1); // negative caching
    const m = (await pool().query("SELECT hits, misses FROM cache_metrics WHERE name = 'test'")).rows[0];
    expect({ hits: Number(m.hits), misses: Number(m.misses) }).toEqual({ hits: 2, misses: 2 });
  });

  it("never caches errors", async () => {
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error("upstream down");
    };
    await expect(cached(policy, "test:v1:err", failing)).rejects.toThrow();
    await expect(cached(policy, "test:v1:err", failing)).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it("caches ISBN metadata lookups and falls back cleanly when the upstream fails", async () => {
    process.env.CATALOG_LOOKUP = "openlibrary";
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            "ISBN:9780306406157": { title: "Sample Title", authors: [{ name: "A. Author" }], publish_date: "1999" },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect((await lookupIsbn("0-306-40615-2"))?.title).toBe("Sample Title");
    expect((await lookupIsbn("9780306406157"))?.publicationYear).toBe(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad", { status: 400 })),
    );
    expect(await lookupIsbn("9781861972712")).toBeNull();
  });
});

describe("outbound http client", () => {
  it("retries 5xx with backoff, but not 4xx", async () => {
    const flaky = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", flaky);
    expect(await fetchJson("https://example.test/a", { retries: 2 })).toEqual({ ok: true });
    expect(flaky).toHaveBeenCalledTimes(2);

    const bad = vi.fn(async () => new Response("", { status: 400 }));
    vi.stubGlobal("fetch", bad);
    await expect(fetchJson("https://example.test/b", { retries: 3 })).rejects.toBeInstanceOf(UpstreamError);
    expect(bad).toHaveBeenCalledTimes(1);
  });
});
