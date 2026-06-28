import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Contact, UserSearch, Users, Mail, Workflow, Filter } from "lucide-react";

export const Route = createFileRoute("/contacts")({
  head: () => ({
    meta: [
      { title: "Contact Intelligence Hub — LeadForge" },
      { name: "description", content: "Enrich decision-maker and contact data for businesses." },
    ],
  }),
  component: ContactsLayout,
});

const tabs = [
  { to: "/contacts", label: "Overview", icon: Contact, exact: true },
  { to: "/contacts/decision-makers", label: "Decision Makers", icon: UserSearch },
  { to: "/contacts/website-contacts", label: "Website Contacts", icon: Users },
  { to: "/contacts/emails", label: "Emails", icon: Mail },
  { to: "/contacts/processing", label: "Processing", icon: Workflow },
  { to: "/contacts/rules", label: "Rules", icon: Filter },
] as const;

function ContactsLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900 md:text-3xl">Contact Intelligence Hub</h1>
          <p className="mt-1 text-sm text-slate-500">Find decision makers, enrich contacts, resolve emails.</p>
        </header>
        <nav className="mb-6 flex flex-wrap gap-1.5 rounded-2xl border border-white/60 bg-white/60 p-1.5 backdrop-blur-md shadow-sm">
          {tabs.map((t) => {
            const active = t.exact ? path === t.to : path.startsWith(t.to);
            return (
              <Link
                key={t.to}
                to={t.to}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition ${active ? "bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </Link>
            );
          })}
        </nav>
        <Outlet />
      </div>
    </div>
  );
}