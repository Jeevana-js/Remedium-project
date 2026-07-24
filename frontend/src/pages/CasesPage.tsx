import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import type { Case } from "../types";
import AppCentralTicketForm from "../components/case/AppCentralTicketForm";
import StatusBadge from "../components/ui/StatusBadge";
import ConfidenceBadge from "../components/ui/ConfidenceBadge";
import { Trash2, Zap } from "lucide-react";

type FormMode = "none" | "fetch";

export default function CasesPage() {
  const [formMode, setFormMode] = useState<FormMode>("none");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: cases = [], isLoading } = useQuery<Case[]>({
    queryKey: ["cases"],
    queryFn: () => axios.get("/api/cases/").then((r) => r.data),
    refetchInterval: 4000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => axios.delete(`/api/cases/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      setPendingDeleteId(null);
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Resolve</h1>
          <p className="text-sm text-slate-400 mt-1">
            Autonomous case triage — paste a case, get a complete packet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-primary"
            onClick={() => setFormMode((m) => (m === "fetch" ? "none" : "fetch"))}
          >
            <Zap size={14} />
            {formMode === "fetch" ? "Cancel" : "Fetch All New Tickets"}
          </button>
        </div>
      </div>

      {formMode === "fetch" && (
        <AppCentralTicketForm
          defaultMode="sync"
          onCreated={(c) => { setFormMode("none"); navigate(`/cases/${c.id}`); }}
        />
      )}

      {isLoading ? (
        <p className="text-slate-400 text-sm">Loading cases…</p>
      ) : (
        <div className="card divide-y divide-surface-3">
          {cases.length === 0 ? (
            <p className="py-6 text-center text-slate-500 text-sm">
              No cases yet. Fetch your first ticket above.
            </p>
          ) : (
            cases.map((c) => (
              <div
                key={c.id}
                className="w-full flex items-center gap-2 py-1.5 px-1 hover:bg-surface-3/50 transition-colors rounded-lg"
              >
                <button
                  onClick={() => navigate(`/cases/${c.id}`)}
                  className="flex-1 min-w-0 text-left py-2 flex items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-100 truncate">
                      {c.external_id && (
                        <span className="text-brand-400 font-mono text-xs mr-1.5">{c.external_id}</span>
                      )}
                      {c.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {c.customer || "—"} · {c.product || "—"} · {c.version || "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {c.packet && (
                      <ConfidenceBadge score={c.packet.confidence} showLabel={false} />
                    )}
                    {c.status === "resolved" && c.category === "known_issue" ? (
                      <span className="badge-green">Already Solved</span>
                    ) : (
                      <StatusBadge status={c.status} />
                    )}
                  </div>
                </button>

                {pendingDeleteId === c.id ? (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => deleteMutation.mutate(c.id)}
                      disabled={deleteMutation.isPending}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-50"
                    >
                      {deleteMutation.isPending ? "Deleting…" : "Confirm"}
                    </button>
                    <button
                      onClick={() => setPendingDeleteId(null)}
                      className="text-xs px-2.5 py-1.5 rounded-lg text-slate-400 hover:bg-surface-3 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setPendingDeleteId(c.id)}
                    className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                    title="Delete case"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
