// Server-only fetch helpers: timeout via AbortController + retry with backoff.
// Use for outbound calls to Apify, Lovable AI Gateway, and Supabase Data API
// inside Cloudflare Workers where long requests get connection-dropped.

export type RetryFetchInit = RequestInit & {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  retryOn?: (res: Response) => boolean;
};

export async function fetchWithRetry(url: string, init: RetryFetchInit = {}): Promise<Response> {
  const {
    timeoutMs = 90_000,
    retries = 1,
    backoffMs = 1500,
    retryOn = (r) => r.status >= 500 || r.status === 408 || r.status === 429,
    ...rest
  } = init;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...rest, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok && retryOn(res) && attempt < retries) {
        await sleep(backoffMs * (attempt + 1));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        await sleep(backoffMs * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("fetchWithRetry failed");
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// Extract first JSON object from a possibly-noisy LLM string.
export function extractJson<T = unknown>(raw: string): T | null {
  if (!raw) return null;
  // Strip code fences
  const cleaned = raw.replace(/```json\s*|```/gi, "");
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}