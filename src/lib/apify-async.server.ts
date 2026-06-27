// Async Apify runner. Instead of blocking on /run-sync-get-dataset-items
// (which routinely drops on Cloudflare Workers for 60s+ actors), we:
//   1) POST /runs to START the run (returns immediately with runId)
//   2) Poll GET /actor-runs/{runId} every few seconds (short subrequests)
//   3) On SUCCEEDED, fetch dataset items in one short call
// This is dramatically more reliable: each subrequest is < 5s, total wall
// time can be 2–3 minutes without a single dropped connection.

import { fetchWithRetry } from "@/lib/fetch-retry";

type RunResponse = {
  data?: {
    id?: string;
    status?: string;
    defaultDatasetId?: string;
    statusMessage?: string;
  };
};

const TERMINAL_BAD = new Set(["FAILED", "ABORTED", "TIMED-OUT", "TIMING-OUT"]);

export async function runApifyActorAsync<T = Record<string, unknown>>(
  actorId: string,
  input: Record<string, unknown>,
  opts: {
    token: string;
    pollIntervalMs?: number;
    maxWaitMs?: number;
    startTimeoutMs?: number;
    pollTimeoutMs?: number;
  },
): Promise<{ ok: true; items: T[]; runId: string } | { ok: false; error: string; runId?: string }> {
  const {
    token,
    pollIntervalMs = 4_000,
    maxWaitMs = 180_000, // 3 min cap
    startTimeoutMs = 20_000,
    pollTimeoutMs = 15_000,
  } = opts;

  // 1) START run (returns ~instantly with runId)
  let startRes: Response;
  try {
    startRes = await fetchWithRetry(
      `https://api.apify.com/v2/acts/${actorId}/runs?token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        timeoutMs: startTimeoutMs,
        retries: 1,
        backoffMs: 1500,
      },
    );
  } catch (err) {
    return { ok: false, error: `Apify start failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!startRes.ok) {
    const t = await startRes.text().catch(() => "");
    return { ok: false, error: `Apify start ${startRes.status}: ${t.slice(0, 200)}` };
  }
  const startJson = (await startRes.json()) as RunResponse;
  const runId = startJson.data?.id;
  if (!runId) return { ok: false, error: "Apify start returned no runId" };

  // 2) POLL until terminal status (or wall-time cap)
  const deadline = Date.now() + maxWaitMs;
  let datasetId: string | undefined;
  let lastStatus = "";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    let pollRes: Response;
    try {
      pollRes = await fetchWithRetry(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${token}`,
        { method: "GET", timeoutMs: pollTimeoutMs, retries: 1, backoffMs: 1000 },
      );
    } catch {
      continue; // transient poll failure, try again
    }
    if (!pollRes.ok) continue;
    const pollJson = (await pollRes.json().catch(() => ({}))) as RunResponse;
    lastStatus = pollJson.data?.status ?? "";
    datasetId = pollJson.data?.defaultDatasetId;
    if (lastStatus === "SUCCEEDED") break;
    if (TERMINAL_BAD.has(lastStatus)) {
      return { ok: false, runId, error: `Apify run ${lastStatus}${pollJson.data?.statusMessage ? `: ${pollJson.data.statusMessage}` : ""}` };
    }
  }
  if (lastStatus !== "SUCCEEDED") {
    return { ok: false, runId, error: `Apify run did not finish within ${Math.round(maxWaitMs / 1000)}s (last status: ${lastStatus || "unknown"})` };
  }
  if (!datasetId) return { ok: false, runId, error: "Apify run succeeded but no dataset" };

  // 3) FETCH dataset items (short call)
  let itemsRes: Response;
  try {
    itemsRes = await fetchWithRetry(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&clean=true`,
      { method: "GET", timeoutMs: 20_000, retries: 1, backoffMs: 1000 },
    );
  } catch (err) {
    return { ok: false, runId, error: `Dataset fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!itemsRes.ok) {
    const t = await itemsRes.text().catch(() => "");
    return { ok: false, runId, error: `Dataset fetch ${itemsRes.status}: ${t.slice(0, 200)}` };
  }
  const items = (await itemsRes.json().catch(() => [])) as T[];
  return { ok: true, items: Array.isArray(items) ? items : [], runId };
}