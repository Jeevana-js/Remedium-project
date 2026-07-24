import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { AdoWorkItem, Case, KBHealthReport } from "../types";
import StatusBadge from "../components/ui/StatusBadge";
import { Inbox, GitBranch, FlaskConical, BookOpen, Plug } from "lucide-react";
import { Link } from "react-router-dom";
import { useAdoStore } from "../store/useAdoStore";

const ADO_STATE_BADGE: Record<string, string> = {
  New: "badge-blue",
  Active: "badge-amber",
  Resolved: "badge-green",
  Closed: "badge-green",
  Removed: "badge-red",
};

export default function DashboardPage() {
  const adoConnection = useAdoStore((s) => s.connection);

  const { data: cases = [] } = useQuery<Case[]>({
    queryKey: ["cases"],
    queryFn: () => axios.get("/api/cases/").then((r) => r.data),
    refetchInterval: 5000,
  });

  const { data: kbHealth } = useQuery<KBHealthReport>({
    queryKey: ["kb-health"],
    queryFn: () => axios.post("/api/kb/health").then((r) => r.data),
  });

  const { data: adoItems = [], isLoading: adoLoading, isError: adoError } = useQuery<AdoWorkItem[]>({
    queryKey: ["ado-backlog", adoConnection?.sessionId],
    queryFn: () => axios.get("/api/ado/backlog?top=8").then((r) => r.data),
    enabled: !!adoConnection,
    refetchInterval: 30_000,
  });

  const stats = {
    total: cases.length,
    pending: cases.filter((c) => c.status === "pending_approval").length,
    resolved: cases.filter((c) => c.status === "resolved").length,
    escalated: cases.filter((c) => c.status === "escalated").length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-slate-400 mt-1">Support intelligence overview</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Cases", value: stats.total, icon: Inbox },
          { label: "Awaiting Approval", value: stats.pending, icon: GitBranch },
          { label: "Resolved", value: stats.resolved, icon: FlaskConical },
          { label: "Escalated", value: stats.escalated, icon: BookOpen },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="card flex items-center gap-4 min-w-0">
            <div className="p-2.5 rounded-lg bg-brand-600/20 flex-shrink-0">
              <Icon size={18} className="text-brand-500" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-slate-400 truncate">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* KB Health */}
      {kbHealth && (
        <div className="card">
          <h2 className="text-sm font-semibold mb-4">LiveKB Health</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-center">
            {[
              { label: "Total Articles", value: kbHealth.total_articles },
              { label: "Healthy", value: kbHealth.healthy, color: "text-emerald-400" },
              { label: "Stale", value: kbHealth.stale, color: "text-amber-400" },
              { label: "Contradictions", value: kbHealth.contradictions, color: "text-red-400" },
              { label: "Coverage Gaps", value: kbHealth.coverage_gaps, color: "text-red-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-surface rounded-lg p-3 min-w-0">
                <p className={`text-xl font-bold ${color ?? ""}`}>{value}</p>
                <p className="text-xs text-slate-400 mt-0.5 break-words">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent cases */}
      <div className="card">
        <h2 className="text-sm font-semibold mb-4">Recent Cases</h2>
        {cases.length === 0 ? (
          <p className="text-sm text-slate-500">No cases yet. Ingest one from the Resolve tab.</p>
        ) : (
          <div className="divide-y divide-surface-3">
            {cases.slice(0, 10).map((c) => (
              <div key={c.id} className="py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {c.customer} · {c.product}
                  </p>
                </div>
                <StatusBadge status={c.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Azure DevOps backlog */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Azure DevOps Backlog</h2>
          {adoConnection && (
            <span className="text-xs text-slate-500 truncate max-w-[50%]">
              {adoConnection.project}
            </span>
          )}
        </div>

        {!adoConnection ? (
          <div className="flex items-center justify-between gap-3 py-2">
            <p className="text-sm text-slate-500">Connect a board to see live tickets here.</p>
            <Link to="/ado-connection" className="btn-ghost py-1.5 text-xs flex-shrink-0">
              <Plug size={13} /> Connect
            </Link>
          </div>
        ) : adoLoading ? (
          <p className="text-sm text-slate-500">Loading tickets…</p>
        ) : adoError ? (
          <p className="text-sm text-red-400">
            Could not load tickets. The connection may have expired — try reconnecting.
          </p>
        ) : adoItems.length === 0 ? (
          <p className="text-sm text-slate-500">No backlog items found for this team.</p>
        ) : (
          <div className="divide-y divide-surface-3">
            {adoItems.map((item) => {
              const f = item.fields;
              const state = f["System.State"] ?? "";
              const assignee = f["System.AssignedTo"];
              const assigneeName =
                typeof assignee === "string" ? assignee : assignee?.displayName;
              return (
                <div key={item.id} className="py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      #{item.id} {f["System.Title"]}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {f["System.WorkItemType"]}
                      {assigneeName ? ` · ${assigneeName}` : ""}
                    </p>
                  </div>
                  <span className={ADO_STATE_BADGE[state] ?? "badge-blue"}>{state}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
