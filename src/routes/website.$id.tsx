import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Copy,
  Globe,
  Image as ImageIcon,
  Instagram,
  Loader2,
  MapPin,
  Palette,
  RefreshCw,
  Sparkles,
  Star,
  Users,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isPackageStale, type WebsiteDataPackage } from "@/lib/website-package";

export const Route = createFileRoute("/website/$id")({
  head: () => ({ meta: [{ title: "Website Builder — LeadForge" }] }),
  component: WebsiteBuilderPage,
});

type Row = {
  id: string;
  title: string | null;
  website: string | null;
  website_package: WebsiteDataPackage | null;
  website_package_version: number | null;
  website_package_built_at: string | null;
};

async function fetchRow(id: string): Promise<Row | null> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, title, website, website_package, website_package_version, website_package_built_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Row | null) ?? null;
}

function WebsiteBuilderPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { data, isLoading, refetch } = useQuery({ queryKey: ["wdp", id], queryFn: () => fetchRow(id) });
  const [rebuilding, setRebuilding] = useState(false);

  const pkg = data?.website_package ?? null;
  const stale = useMemo(() => isPackageStale(data?.website_package_version), [data]);

  const rebuild = async () => {
    setRebuilding(true);
    try {
      const res = await fetch("/api/public/website-package/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Rebuild failed");
      toast.success("Website package rebuilt");
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rebuild failed");
    } finally {
      setRebuilding(false);
    }
  };

  const copyJson = async () => {
    if (!pkg) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(pkg, null, 2));
      toast.success("Copied WDP JSON");
    } catch {
      toast.error("Copy failed");
    }
  };

  const sendToGenerator = () => {
    if (!pkg) return;
    const prompt =
      "Build a premium, modern, conversion-focused website for this business using ONLY the structured data below. Use the brand colors, logo, fonts, hero image, services, reviews, hours and contact info as the source of truth.\n\n" +
      "WEBSITE_DATA_PACKAGE:\n" +
      JSON.stringify(pkg, null, 2);
    const url = "https://lovable.dev/?autosubmit=true#prompt=" + encodeURIComponent(prompt);
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
    a.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window, ctrlKey: !isMac, metaKey: isMac }),
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-rose-600">Lead not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.history.back()}
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <Link to="/leads/$id" params={{ id }} className="text-sm text-indigo-600 hover:underline">
          View full lead (outreach) →
        </Link>
      </div>

      {/* Header */}
      <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-white via-violet-50/40 to-fuchsia-50/40 p-6 shadow-sm backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-violet-600">
              <Wand2 className="h-3.5 w-3.5" /> Website Builder
            </div>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">{data.title || "Untitled"}</h1>
            <p className="mt-1 text-xs text-slate-500">
              Clean, filtered data only — irrelevant fields stripped. Raw data lives on the lead detail page.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${
                pkg && !stale ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {pkg ? (stale ? "Stale" : `v${data.website_package_version}`) : "Missing"}
            </span>
            {data.website_package_built_at && (
              <span className="text-[10px] text-slate-400">
                built {new Date(data.website_package_built_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={rebuild}
            disabled={rebuilding}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {rebuilding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Rebuild package
          </button>
          <button
            onClick={copyJson}
            disabled={!pkg}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" /> Copy JSON
          </button>
          <button
            onClick={sendToGenerator}
            disabled={!pkg}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-500/30 hover:shadow-lg disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" /> Send to website generator
          </button>
        </div>
      </div>

      {!pkg ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          No package built yet. Click <strong>Rebuild package</strong> above to generate one from the current raw
          data.
        </div>
      ) : (
        <>
          {/* Business */}
          <Section icon={<Building2 className="h-4 w-4" />} title="Business">
            <KeyValue k="Name" v={pkg.business.name} />
            <KeyValue k="Owner" v={pkg.business.owner} />
            <KeyValue k="Tagline" v={pkg.business.tagline} />
            <KeyValue k="Description" v={pkg.business.description} multiline />
            <Pills label="Categories" items={pkg.business.categories} />
            <Pills label="Services" items={pkg.business.services} />
            <Pills label="Attributes" items={pkg.business.attributes} accent="emerald" />
          </Section>

          {/* Contact */}
          <Section icon={<MapPin className="h-4 w-4" />} title="Contact">
            <KeyValue k="Phone" v={pkg.contact.phone} />
            <KeyValue k="Emails" v={pkg.contact.emails.join(", ")} />
            <KeyValue k="Address" v={pkg.contact.address?.full} />
            {pkg.contact.hours.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Hours</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3">
                  {pkg.contact.hours.map((h) => (
                    <div key={h.day} className="flex justify-between">
                      <span className="text-slate-500">{h.day}</span>
                      <span className="text-slate-800">{h.hours}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {Object.keys(pkg.contact.socials).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(pkg.contact.socials).map(([name, url]) => (
                  <a
                    key={name}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-200"
                  >
                    {name}
                  </a>
                ))}
              </div>
            )}
          </Section>

          {/* Brand */}
          <Section icon={<Palette className="h-4 w-4 text-violet-600" />} title="Brand">
            <div className="flex items-start gap-4">
              {pkg.brand.logoUrl ? (
                <img
                  src={pkg.brand.logoUrl}
                  alt="Logo"
                  className="h-16 w-16 rounded-xl border border-slate-200 bg-white object-contain p-1"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-slate-300 text-[10px] text-slate-400">
                  no logo
                </div>
              )}
              <div className="flex-1 space-y-2">
                {pkg.brand.colors.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Colors</p>
                    <div className="flex flex-wrap gap-1.5">
                      {pkg.brand.colors.map((c) => (
                        <span
                          key={c}
                          className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600"
                          title={c}
                        >
                          <span className="h-3 w-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: c }} />
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <Pills label="Fonts" items={pkg.brand.fonts} />
                <KeyValue k="Tone" v={pkg.brand.tone} />
              </div>
            </div>
          </Section>

          {/* Media */}
          <Section icon={<ImageIcon className="h-4 w-4" />} title={`Media (${pkg.media.gallery.length})`}>
            {pkg.media.gallery.length === 0 ? (
              <p className="text-xs text-slate-500">No images extracted.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {pkg.media.gallery.map((url, i) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`group relative overflow-hidden rounded-lg border ${i === 0 ? "border-violet-400 ring-2 ring-violet-200" : "border-slate-200"}`}
                  >
                    <img src={url} alt="" className="aspect-square w-full object-cover transition group-hover:scale-105" />
                    {i === 0 && (
                      <span className="absolute bottom-1 left-1 rounded bg-violet-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                        Hero
                      </span>
                    )}
                  </a>
                ))}
              </div>
            )}
          </Section>

          {/* Reviews */}
          <Section icon={<Star className="h-4 w-4 fill-amber-400 text-amber-400" />} title={`Reviews (${pkg.reviews.length})`}>
            {pkg.reviews.length === 0 ? (
              <p className="text-xs text-slate-500">No qualifying reviews found.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {pkg.reviews.map((r, i) => (
                  <div key={i} className="rounded-xl border border-slate-200 bg-white/60 p-3">
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-slate-700">{r.author || "Anonymous"}</span>
                      {r.rating != null && (
                        <span className="flex items-center gap-0.5 text-amber-600">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {r.rating}
                        </span>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed text-slate-700">{r.text}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Updates */}
          {pkg.updates.length > 0 && (
            <Section icon={<Globe className="h-4 w-4" />} title={`Owner updates (${pkg.updates.length})`}>
              <div className="space-y-2">
                {pkg.updates.map((u, i) => (
                  <div key={i} className="rounded-xl border border-slate-200 bg-white/60 p-3 text-xs text-slate-700">
                    {u.date && <p className="mb-1 text-[10px] text-slate-400">{u.date}</p>}
                    <p>{u.text}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Instagram */}
          {pkg.instagram && (
            <Section icon={<Instagram className="h-4 w-4 text-fuchsia-600" />} title="Instagram">
              <KeyValue k="Handle" v={pkg.instagram.handle ? `@${pkg.instagram.handle}` : undefined} />
              <KeyValue k="Followers" v={pkg.instagram.followers?.toLocaleString()} />
              <KeyValue k="Verified" v={pkg.instagram.verified ? "Yes" : undefined} />
              <KeyValue k="Bio" v={pkg.instagram.bio} multiline />
            </Section>
          )}

          {/* Raw JSON preview */}
          <details className="rounded-2xl border border-slate-200 bg-white/70 p-5 backdrop-blur-xl">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">
              <Users className="mr-1.5 inline h-4 w-4 text-slate-500" />
              Preview Website Data Package (JSON)
            </summary>
            <pre className="mt-3 max-h-[500px] overflow-auto rounded-lg bg-slate-900 p-4 text-[11px] leading-relaxed text-slate-100">
              {JSON.stringify(pkg, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 p-5 backdrop-blur-xl">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
        {icon} {title}
      </h2>
      {children}
    </div>
  );
}

function KeyValue({ k, v, multiline }: { k: string; v?: string; multiline?: boolean }) {
  if (!v) return null;
  return (
    <div className="mb-1.5 flex gap-2 text-xs">
      <span className="w-24 shrink-0 text-slate-500">{k}</span>
      <span className={`flex-1 text-slate-800 ${multiline ? "" : "truncate"}`}>{v}</span>
    </div>
  );
}

function Pills({ label, items, accent }: { label: string; items: string[]; accent?: "emerald" }) {
  if (!items?.length) return null;
  const cls =
    accent === "emerald"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <div className="mb-2">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((s) => (
          <span key={s} className={`rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}