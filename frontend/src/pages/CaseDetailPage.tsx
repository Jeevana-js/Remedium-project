import { useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { Case } from "../types";
import CasePacketView from "../components/case/CasePacketView";
import ResolveWithClaude from "../components/case/ResolveWithClaude";
import StatusBadge from "../components/ui/StatusBadge";
import { ArrowLeft } from "lucide-react";

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: caseData, isLoading } = useQuery<Case>({
    queryKey: ["case", id],
    queryFn: () => axios.get(`/api/cases/${id}`).then((r) => r.data),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "analysing" || status === "ingested" || status === "resolving" ? 2000 : false;
    },
  });

  // When a Claude resolution finishes (live resolving → resolved transition),
  // move straight to TestForge for regression testing, carrying the resolution
  // as the fix description. Guarding on the previous status means this only
  // fires on a fresh resolution — not when simply opening an already-resolved
  // case. TestForge auto-generates the test from this navigation state.
  const prevStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = caseData?.status;
    if (prev === "resolving" && curr === "resolved" && caseData?.resolution_output) {
      navigate("/test-forge", {
        state: {
          bug_title: caseData.title,
          bug_description: caseData.description,
          fix_description: caseData.resolution_output,
          case_id: caseData.id,
        },
      });
    }
    prevStatusRef.current = curr;
  }, [caseData?.status, caseData?.resolution_output, caseData?.id, caseData?.title, caseData?.description, navigate]);

  if (isLoading || !caseData) {
    return <div className="text-slate-400 text-sm">Loading…</div>;
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/cases")} className="btn-ghost py-1.5 px-2">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{caseData.title}</h1>
          {(caseData.customer || caseData.product || caseData.version) && (
            <p className="text-xs text-slate-500 mt-0.5">
              {[
                caseData.customer,
                caseData.product && caseData.version
                  ? `${caseData.product} v${caseData.version}`
                  : caseData.product,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
        <StatusBadge status={caseData.status} />
      </div>

      <div className="card">
        <h3 className="text-xs text-slate-400 mb-1">Case Description</h3>
        <p className="text-sm text-slate-300 whitespace-pre-wrap">{caseData.description}</p>
      </div>

      <ResolveWithClaude caseData={caseData} />

      {caseData.status === "resolving" && (
        <div className="card flex items-center gap-3 text-slate-400">
          <span className="animate-spin">⟳</span> Claude is analysing this case…
        </div>
      )}

      {caseData.resolution_output && (
        <div className="card border-emerald-500/30 space-y-2">
          <h3 className="text-sm font-semibold text-emerald-400">Claude's Resolution</h3>
          <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
            {caseData.resolution_output}
          </p>
        </div>
      )}

      {caseData.resolution_error && (
        <div className="card border-red-500/30 space-y-1">
          <h3 className="text-sm font-semibold text-red-400">Resolution Failed</h3>
          <p className="text-xs text-slate-400">{caseData.resolution_error}</p>
        </div>
      )}

      <CasePacketView caseData={caseData} />
    </div>
  );
}
