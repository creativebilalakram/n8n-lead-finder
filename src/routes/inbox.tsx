import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Inbox as InboxIcon,
  Loader2,
  ExternalLink,
  Filter as FilterIcon,
  Users,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deriveContactStatus,
  getInboxLeads,
  setOutreachStatus,
  type InboxRow,
  type OutreachStatus,
} from "@/lib/contact-hub-db";

export const Route = createFileRoute("/inbox")({
  head: () => ({ meta: [{ title: "Inbox — LeadForge" }] }),
  component: InboxPage,
});

type FilterKey = "all" | "no_contacts" | "ready" | "sent" | "replied" | "not_interested";

const FILTERS: { key: FilterKey; label: string; emoji: string }[] = [
  { key: "all", label: "All", emoji: "📥" },
  { key: "no_contacts", label: "No contacts", emoji: "🔴" },
  { key: "ready", label: "Ready to outreach", emoji: "🟡" },
  { key: "sent", label: "Sent", emoji: "🟢" },
  { key: "replied", label: "Replied", emoji: "💬" },
  { key: "not_interested", label: "Not interested", emoji: "❌" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function InboxPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["inbox-leads"],
    queryFn: getInboxLeads,
    staleTime: 10_000,
  });

  const rows = data ?? [];

  const counts = useMemo(() => {
    const map: Record<FilterKey, number> = {
      all: rows.length,
      no_contacts: 0,
      ready: 0,
      sent: 0,
      replied: 0,
      not_interested: 0,
    };
    for (const r of rows) {
      const k = deriveContactStatus(r).key;
      map[k] = (map[k] ?? 0) + 1;
    }
    return map;
  }, [rows]);

  const visible = useMemo(() => {
    let list = rows;
    if (filter !== "all") list = list.filter((r) => deriveContactStatus(r).key === filter);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((r) => `${r.title} ${r.city ?? ""}`.toLowerCase().includes(q));
    return list;
  }, [rows, filter, query]);

  const updateStatus = async (row: InboxRow, status: OutreachStatus | null) => {
    try {
      await setOutreachStatus(row.id, status);
      toast.success(status ? `Marked as ${status.replace("_", " ")}` : "Status cleared");
      qc.invalidateQueries({ queryKey: ["inbox-leads"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
            <InboxIcon className="h-6 w-6 text-indigo-500" /> Inbox
          </h1>
          <p className="text-sm text-slate-500">
            Outreach tracker across all qualified Hot/Warm leads.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search business or city…"
            className="h-9 w-64"
          />
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                active
                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white/70 text-slate-600 hover:bg-white"
              }`}
            >
              <span>{f.emoji}</span>
              {f.label}
              <span
                className={`rounded-full px-1.5 text-[10px] ${active ? "bg-white text-indigo-700" : "bg-slate-100 text-slate-500"}`}
              >
                {counts[f.key]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/70 backdrop-blur-xl shadow-sm">
        {isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading inbox…
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-rose-600">Failed to load inbox: {(error as Error).message}</div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-slate-500">
            <FilterIcon className="h-6 w-6 text-slate-400" />
            No leads match this filter.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>City</TableHead>
                <TableHead className="w-20">Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-28">Contacts</TableHead>
                <TableHead>Last action</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => {
                const s = deriveContactStatus(r);
                return (
                  <TableRow key={r.id} className="hover:bg-white">
                    <TableCell>
                      <Link
                        to="/leads/$id"
                        params={{ id: r.id }}
                        className="flex items-center gap-1.5 font-medium text-slate-900 hover:text-indigo-600"
                      >
                        {r.title}
                        <ExternalLink className="h-3 w-3 opacity-50" />
                      </Link>
                      {r.lead_tier && (
                        <span className="mt-0.5 inline-block rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                          {r.lead_tier}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">{r.city ?? "—"}</TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">{r.lead_score ?? "—"}</span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.color}`}
                      >
                        <span>{s.emoji}</span> {s.label}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-xs text-slate-600">
                        <Users className="h-3 w-3 text-slate-400" />
                        {r.dmWithContacts}/{r.dmCount}
                        {r.hasBusinessChannels && (
                          <CheckCircle2 className="ml-1 h-3 w-3 text-emerald-500" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      <div>{fmtDate(r.last_action_at)}</div>
                      {r.last_action_note && (
                        <div className="truncate text-[10px] text-slate-400" title={r.last_action_note}>
                          {r.last_action_note}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="outline" className="h-7 text-[11px]">
                            Update
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => updateStatus(r, "sent")}>
                            🟢 Mark Sent
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateStatus(r, "replied")}>
                            💬 Mark Replied
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateStatus(r, "not_interested")}>
                            ❌ Not interested
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateStatus(r, null)}>
                            Clear status
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}