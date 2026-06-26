import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// "Opened in Lovable" state is persisted in the `leads.opened_at` column
// so it survives across browsers, devices, and cache clears.

const cache = new Set<string>();
let loaded = false;
let loadingPromise: Promise<void> | null = null;
const EVENT = "opened-leads-changed";

function emit() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT));
  }
}

async function loadOpened(): Promise<void> {
  if (loaded) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      // Page through to avoid the default 1000-row limit.
      const pageSize = 1000;
      let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase
          .from("leads")
          .select("id")
          .not("opened_at", "is", null)
          .range(from, from + pageSize - 1);
        if (error) break;
        const rows = data ?? [];
        for (const r of rows) {
          if (r.id) cache.add(r.id as string);
        }
        if (rows.length < pageSize) break;
        from += pageSize;
      }
    } finally {
      loaded = true;
      loadingPromise = null;
      emit();
    }
  })();
  return loadingPromise;
}

export function leadKey(lead: unknown): string {
  if (lead && typeof lead === "object" && "id" in lead) {
    const id = (lead as { id?: unknown }).id;
    return typeof id === "string" ? id : "";
  }
  return "";
}

export function isClicked(key: string): boolean {
  return !!key && cache.has(key);
}

export async function markClicked(key: string): Promise<void> {
  if (!key) return;
  cache.add(key);
  emit();
  const { error } = await supabase
    .from("leads")
    .update({ opened_at: new Date().toISOString() })
    .eq("id", key);
  if (error) {
    cache.delete(key);
    emit();
    throw error;
  }
}

export async function toggleClicked(key: string): Promise<void> {
  if (!key) return;
  const was = cache.has(key);
  if (was) cache.delete(key);
  else cache.add(key);
  emit();
  const { error } = await supabase
    .from("leads")
    .update({ opened_at: was ? null : new Date().toISOString() })
    .eq("id", key);
  if (error) {
    // Roll back optimistic flip
    if (was) cache.add(key);
    else cache.delete(key);
    emit();
    throw error;
  }
}

export function subscribeClicked(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

export function useClickedSync(): boolean {
  // Returns whether the opened-set has finished loading from the DB.
  const [ready, setReady] = useState(loaded);
  const [, setTick] = useState(0);
  useEffect(() => {
    const unsub = subscribeClicked(() => {
      setReady(loaded);
      setTick((t) => t + 1);
    });
    if (!loaded) void loadOpened();
    else setReady(true);
    return unsub;
  }, []);
  return ready;
}

export function ensureOpenedLoaded(): Promise<void> {
  return loadOpened();
}