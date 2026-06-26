import { useEffect, useState } from "react";

const KEY = "lead-gen-clicked-v1";

function read(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function write(set: Set<string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify([...set]));
  window.dispatchEvent(new Event("clicked-leads-changed"));
}

export function leadKey(lead: {
  placeId?: unknown;
  fid?: unknown;
  lovableUrl?: string;
  title?: string;
  address?: string;
}): string {
  const pid = (lead.placeId ?? lead.fid) as string | undefined;
  if (pid) return String(pid);
  if (lead.lovableUrl) return lead.lovableUrl;
  return `${lead.title ?? ""}|${lead.address ?? ""}`;
}

export function isClicked(key: string): boolean {
  return read().has(key);
}

export function markClicked(key: string) {
  const s = read();
  s.add(key);
  write(s);
}

export function toggleClicked(key: string) {
  const s = read();
  if (s.has(key)) s.delete(key);
  else s.add(key);
  write(s);
}

export function subscribeClicked(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener("clicked-leads-changed", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("clicked-leads-changed", handler);
    window.removeEventListener("storage", handler);
  };
}

export function useClickedSync(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeClicked(() => setTick((t) => t + 1)), []);
  return tick;
}