import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Settings as SettingsIcon, RotateCcw, Check } from "lucide-react";
import {
  DEFAULT_FILTERS,
  type FilterSettings,
  useFilterSettings,
} from "@/lib/filter-settings";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — LeadForge" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [settings, setSettings] = useFilterSettings();
  const [draft, setDraft] = useState<FilterSettings>(settings);
  const [saved, setSaved] = useState(false);

  const dirty =
    draft.minReviews !== settings.minReviews ||
    draft.maxReviews !== settings.maxReviews ||
    draft.minRating !== settings.minRating ||
    draft.maxRating !== settings.maxRating ||
    draft.activeOwnerDays !== settings.activeOwnerDays ||
    draft.reviewsEnabled !== settings.reviewsEnabled ||
    draft.ratingEnabled !== settings.ratingEnabled ||
    draft.ownerEnabled !== settings.ownerEnabled;

  const save = () => {
    setSettings(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  const reset = () => {
    setDraft(DEFAULT_FILTERS);
    setSettings(DEFAULT_FILTERS);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-12">
      <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200">
        <SettingsIcon className="h-3.5 w-3.5" />
        Filter Settings
      </div>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        Global qualification filters
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        These filters decide which leads count as <span className="font-semibold">qualified</span>{" "}
        across the whole app. Changes apply live to every lead — past imports too.
      </p>

      <div className="mt-8 space-y-5 rounded-3xl border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur">
        <Pair
          label="Reviews count"
          help="Lead must have between X and Y reviews."
          enabled={draft.reviewsEnabled}
          onToggle={(v) => setDraft({ ...draft, reviewsEnabled: v })}
          minValue={draft.minReviews}
          maxValue={draft.maxReviews}
          step={1}
          onMin={(v) => setDraft({ ...draft, minReviews: v })}
          onMax={(v) => setDraft({ ...draft, maxReviews: v })}
        />
        <Pair
          label="Rating"
          help="Google rating must fall in this window."
          enabled={draft.ratingEnabled}
          onToggle={(v) => setDraft({ ...draft, ratingEnabled: v })}
          minValue={draft.minRating}
          maxValue={draft.maxRating}
          step={0.1}
          onMin={(v) => setDraft({ ...draft, minRating: v })}
          onMax={(v) => setDraft({ ...draft, maxRating: v })}
        />
        <div className={draft.ownerEnabled ? "" : "opacity-60"}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Active owner (days)</div>
              <div className="text-xs text-slate-500">
                Owner must have updated the listing within this many days.
              </div>
            </div>
            <Toggle checked={draft.ownerEnabled} onChange={(v) => setDraft({ ...draft, ownerEnabled: v })} />
          </div>
          <input
            type="number"
            disabled={!draft.ownerEnabled}
            value={draft.activeOwnerDays}
            onChange={(e) =>
              setDraft({ ...draft, activeOwnerDays: Number(e.target.value) || 0 })
            }
            className="mt-2 h-10 w-40 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={save}
            disabled={!dirty}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 to-fuchsia-600 px-5 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saved ? <Check className="h-4 w-4" /> : null}
            {saved ? "Saved" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset defaults
          </button>
          <span className="text-xs text-slate-500">
            Defaults: reviews {DEFAULT_FILTERS.minReviews}–{DEFAULT_FILTERS.maxReviews}, rating{" "}
            {DEFAULT_FILTERS.minRating}–{DEFAULT_FILTERS.maxRating}, owner ≤{" "}
            {DEFAULT_FILTERS.activeOwnerDays}d
          </span>
        </div>
      </div>

      <p className="mt-6 text-xs text-slate-500">
        Tip: <span className="font-medium">Hot / Warm / Mild / Cold</span> tier is based on the
        full lead score and is independent of these filters — it never hides a lead.
      </p>
    </div>
  );
}

function Pair(props: {
  label: string;
  help: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  minValue: number;
  maxValue: number;
  step: number;
  onMin: (v: number) => void;
  onMax: (v: number) => void;
}) {
  return (
    <div className={props.enabled ? "" : "opacity-60"}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{props.label}</div>
          <div className="text-xs text-slate-500">{props.help}</div>
        </div>
        <Toggle checked={props.enabled} onChange={props.onToggle} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Min</span>
          <input
            type="number"
            disabled={!props.enabled}
            step={props.step}
            value={props.minValue}
            onChange={(e) => props.onMin(Number(e.target.value) || 0)}
            className="h-10 w-28 rounded-xl border border-slate-200 bg-white px-3 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Max</span>
          <input
            type="number"
            disabled={!props.enabled}
            step={props.step}
            value={props.maxValue}
            onChange={(e) => props.onMax(Number(e.target.value) || 0)}
            className="h-10 w-28 rounded-xl border border-slate-200 bg-white px-3 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </label>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
        checked ? "bg-indigo-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}