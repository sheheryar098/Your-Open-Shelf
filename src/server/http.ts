/**
 * The one place that calls external HTTP services. Timeouts, retries, backoff with jitter and
 * error mapping live here; domain code calls typed functions, never `fetch` directly.
 */

export class UpstreamError extends Error {
  constructor(message: string, public status: number | null, public retriable: boolean) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface FetchJsonOptions {
  timeoutMs?: number;
  /** Extra attempts after the first, for retriable failures only (network, 429, 5xx). */
  retries?: number;
  headers?: Record<string, string>;
  /** Treat 404 as "no result" instead of an error. */
  notFoundAsNull?: boolean;
}

const USER_AGENT = "YOS-YourOpenShelf/0.1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function retryDelayMs(attempt: number, retryAfterHeader?: string | null): number {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 10_000);
  const ceiling = Math.min(250 * 2 ** attempt, 4_000);
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2)); // jitter
}

export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T | null> {
  const retries = opts.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(opts.timeoutMs ?? 4_000),
        headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...opts.headers },
      });
    } catch (err) {
      if (attempt < retries) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      throw new UpstreamError(`Request to ${new URL(url).host} failed: ${(err as Error).message}`, null, true);
    }
    if (res.ok) return (await res.json()) as T;
    if (res.status === 404 && opts.notFoundAsNull) return null;
    const retriable = res.status === 429 || res.status >= 500;
    if (retriable && attempt < retries) {
      await sleep(retryDelayMs(attempt, res.headers.get("retry-after")));
      continue;
    }
    throw new UpstreamError(`${new URL(url).host} responded ${res.status}`, res.status, retriable);
  }
}
