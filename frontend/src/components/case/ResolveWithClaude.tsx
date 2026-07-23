import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Search, Sparkles, BookOpen } from "lucide-react";
import type { Case, CaseSource } from "../../types";
import { useToastStore } from "../../store/useToastStore";

interface Props {
  caseData: Case;
}

/** Research-first resolution flow: search KB articles for an existing fix
 * before offering to kick off an AI resolution attempt via the Claude CLI. */
export default function ResolveWithClaude({ caseData }: Props) {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.show);
  const [hasSearched, setHasSearched] = useState(false);
  const [matches, setMatches] = useState<CaseSource[]>([]);

  const RELEVANCE_THRESHOLD = 0.75;

  const research = useMutation({
    mutationFn: () =>
      axios.get<CaseSource[]>(`/api/cases/${caseData.id}/research-kb`).then((r) => r.data),
    onSuccess: (sources) => {
      setMatches(sources);
      setHasSearched(true);
    },
    onError: () => {
      showToast({ kind: "error", title: "KB search failed", description: "Could not search KB articles. Try again." });
    },
  });

  const resolve = useMutation({
    mutationFn: () => axios.post(`/api/cases/${caseData.id}/resolve`).then((r) => r.data as Case),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["case", caseData.id] });
      showToast({ kind: "success", title: "Resolution started", description: "Claude is analysing this case." });
    },
    onError: () => {
      showToast({ kind: "error", title: "Could not start resolution", description: "Try again." });
    },
  });

  const bestMatch = matches[0];
  const strongMatch = bestMatch && bestMatch.relevance_score >= RELEVANCE_THRESHOLD;

  if (caseData.status === "resolving" || caseData.status === "resolved") {
    return null;
  }

  return (
    <div className="card space-y-3">
      <h3 className="text-sm font-semibold text-slate-300">Resolve this case</h3>

      {!hasSearched && (
        <button
          onClick={() => research.mutate()}
          disabled={research.isPending}
          className="btn-ghost"
        >
          <Search size={14} /> {research.isPending ? "Searching KB…" : "Research KB Articles"}
        </button>
      )}

      {hasSearched && (
        <div className="space-y-3">
          {matches.length === 0 && (
            <p className="text-xs text-slate-400">No KB articles found for this case.</p>
          )}

          {matches.length > 0 && (
            <div className="space-y-2">
              {matches.slice(0, 3).map((s) => (
                <div
                  key={s.id}
                  className="flex items-start gap-3 p-2 rounded-lg bg-surface hover:bg-surface-3 transition-colors"
                >
                  <BookOpen size={14} className="flex-shrink-0 mt-0.5 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-200 truncate">{s.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{s.excerpt}</p>
                  </div>
                  <span className="flex-shrink-0 text-xs text-slate-500 tabular-nums">
                    {Math.round(s.relevance_score * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}

          {strongMatch ? (
            <p className="text-xs text-emerald-400">
              This looks already covered by "{bestMatch.title}" — review it before resolving.
            </p>
          ) : (
            <button
              onClick={() => resolve.mutate()}
              disabled={resolve.isPending}
              className="btn-primary"
            >
              <Sparkles size={14} /> {resolve.isPending ? "Starting…" : "Resolve"}
            </button>
          )}

          <button
            onClick={() => research.mutate()}
            disabled={research.isPending}
            className="text-xs text-slate-500 hover:text-slate-300 underline"
          >
            Search again
          </button>
        </div>
      )}
    </div>
  );
}
