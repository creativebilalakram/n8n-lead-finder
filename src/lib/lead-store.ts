import type { SearchRecord } from "./lead-types";

const KEY = "lead-gen-searches-v1";
const LEGACY_RESULTS_KEY = "lead-gen-results-v1";

export function loadSearches(): SearchRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SearchRecord[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveSearches(list: SearchRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    localStorage.removeItem(LEGACY_RESULTS_KEY);
  } catch {
    /* ignore */
  }
}

export function addSearch(record: SearchRecord) {
  const list = loadSearches();
  list.unshift(record);
  // cap history to last 50 searches
  saveSearches(list.slice(0, 50));
}

export function deleteSearch(id: string) {
  saveSearches(loadSearches().filter((r) => r.id !== id));
}

export function clearSearches() {
  saveSearches([]);
}

export function getSearch(id: string): SearchRecord | undefined {
  return loadSearches().find((r) => r.id === id);
}