import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Search, Sparkles, BookOpen, ChevronDown } from "lucide-react";
import type { Case, CaseSource, KBArticle } from "../../types";
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const RELEVANCE_THRESHOLD = 0.75;

  // Full article bodies (research-kb only returns short excerpts) — used to show
  // the whole article inline when a match row is clicked open.
  const { data: allArticles = [] } = useQuery({
    queryKey: ["kb-articles"],
    queryFn: () => axios.get<KBArticle[]>("/api/kb/articles").then((r) => r.data),
  });

  const research = useMutation({
    mutationFn: () =>
      axios.get<CaseSource[]>(`/api/cases/${caseData.id}/research-kb`).then((r) => r.data),
    onSuccess: (sources) => {
      setMatches(sources);
      setExpandedId(null);
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

  // Collapse duplicate articles (same title indexed more than once) — keep the
  // first, which is the highest-scoring since research-kb returns sorted hits.
  const uniqueMatches = (() => {
    const seen = new Set<string>();
    return matches.filter((m) => {
      const key = m.title.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  const bestMatch = uniqueMatches[0];
  const strongMatch = bestMatch && bestMatch.relevance_score >= RELEVANCE_THRESHOLD;

  const articleContent = (id: string) =>
    allArticles.find((a) => a.id === id)?.content ?? "Full article content is unavailable.";

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
          {uniqueMatches.length === 0 && (
            <p className="text-xs text-slate-400">No KB articles found for this case.</p>
          )}

          {uniqueMatches.length > 0 && (
            <div className="space-y-2">
              {uniqueMatches.slice(0, 3).map((s) => {
                const isOpen = expandedId === s.id;
                return (
                  <div key={s.id} className="rounded-lg bg-surface overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isOpen ? null : s.id)}
                      className="w-full text-left flex items-start gap-3 p-2 hover:bg-surface-3 transition-colors"
                    >
                      <BookOpen size={14} className="flex-shrink-0 mt-0.5 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-200 truncate">{s.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{s.excerpt}</p>
                      </div>
                      <span className="flex-shrink-0 text-xs text-slate-500 tabular-nums">
                        {Math.round(s.relevance_score * 100)}%
                      </span>
                      <ChevronDown
                        size={14}
                        className={`flex-shrink-0 mt-0.5 text-slate-500 transition-transform ${
                          isOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    {isOpen && (
                      <div className="px-3 pb-3 pt-1 border-t border-white/5">
                        <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                          {articleContent(s.id)}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {strongMatch && (
            <p className="text-xs text-emerald-400">
              This looks already covered by "{bestMatch.title}" — open it above to review before
              resolving.
            </p>
          )}

          <button
            onClick={() => resolve.mutate()}
            disabled={resolve.isPending}
            className="btn-primary"
          >
            <Sparkles size={14} /> {resolve.isPending ? "Starting…" : "Resolve"}
          </button>

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
