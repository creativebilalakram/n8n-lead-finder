const activeLeadOpens = new Set<string>();
const recentLeadOpens = new Map<string, number>();

const RECENT_OPEN_WINDOW_MS = 30_000;

export function acquireLovableOpenLock(key: string): (() => void) | null {
  const now = Date.now();
  const recentAt = recentLeadOpens.get(key);
  if (activeLeadOpens.has(key) || (recentAt && now - recentAt < RECENT_OPEN_WINDOW_MS)) return null;
  activeLeadOpens.add(key);
  return () => activeLeadOpens.delete(key);
}

export function markLovableOpenAttempt(key: string) {
  recentLeadOpens.set(key, Date.now());
}

export function openLovableTabOnce(url: string, key: string): boolean {
  markLovableOpenAttempt(key);
  const opened = window.open(url, "_blank");
  if (!opened) return false;
  try {
    opened.opener = null;
  } catch {
    // Non-fatal: some browsers block opener mutation.
  }
  return true;
}