import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import axios from "axios";
import { BookOpen, ChevronRight, RefreshCw } from "lucide-react";
import type { KBArticle, KBHealthReport } from "../types";

export default function LiveKBPage() {
  const navigate = useNavigate();

  const healthMutation = useMutation({
    mutationFn: () => axios.post<KBHealthReport>("/api/kb/health").then((r) => r.data),
  });

  const { data: articles = [] } = useQuery({
    queryKey: ["kb-articles"],
    queryFn: () => axios.get<KBArticle[]>("/api/kb/articles").then((r) => r.data),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen size={22} className="text-brand-500" /> LiveKB
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Self-maintaining knowledge base — gaps, staleness, contradictions.
          </p>
        </div>
        <button
          onClick={() => healthMutation.mutate()}
          disabled={healthMutation.isPending}
          className="btn-ghost"
        >
          <RefreshCw size={14} className={healthMutation.isPending ? "animate-spin" : ""} />
          Run Health Check
        </button>
      </div>

      {/* Health Report */}
      {healthMutation.data && (
        <div className="card">
          <h2 className="text-sm font-semibold mb-4">Health Report</h2>
          <div className="grid grid-cols-5 gap-3 text-center">
            {[
              { label: "Total", value: healthMutation.data.total_articles },
              { label: "Healthy", value: healthMutation.data.healthy, color: "text-emerald-400" },
              { label: "Stale", value: healthMutation.data.stale, color: "text-amber-400" },
              { label: "Contradictions", value: healthMutation.data.contradictions, color: "text-red-400" },
              { label: "Gaps", value: healthMutation.data.coverage_gaps, color: "text-red-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-surface rounded-lg p-3">
                <p className={`text-2xl font-bold ${color ?? ""}`}>{value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Article list */}
      <div className="card">
        <h2 className="text-sm font-semibold mb-3">Articles ({articles.length})</h2>
        {articles.length === 0 ? (
          <p className="text-sm text-slate-500">No articles yet. Draft one above.</p>
        ) : (
          <div className="divide-y divide-surface-3">
            {articles.map((a) => (
              <button
                key={a.id}
                onClick={() => navigate(`/live-kb/${a.id}`)}
                className="w-full py-3 flex items-center gap-3 text-left hover:bg-surface-3/50 rounded-lg px-2 -mx-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.title}</p>
                  <div className="flex gap-1.5 mt-1 flex-wrap">
                    {a.product && <span className="text-xs text-slate-500">{a.product}</span>}
                    {a.tags?.slice(0, 4).map((t: string) => (
                      <span key={t} className="text-xs text-slate-500">{t}</span>
                    ))}
                  </div>
                </div>
                <span className={
                  a.health === "healthy" ? "badge-green" :
                  a.health === "stale" ? "badge-amber" : "badge-red"
                }>
                  {a.health}
                </span>
                <ChevronRight size={16} className="text-slate-500 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
