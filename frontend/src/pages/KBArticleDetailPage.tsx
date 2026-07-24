import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { ArrowLeft } from "lucide-react";
import type { KBArticle } from "../types";

export default function KBArticleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: article, isLoading } = useQuery<KBArticle>({
    queryKey: ["kb-article", id],
    queryFn: () =>
      axios.get<KBArticle[]>("/api/kb/articles").then((r) => {
        const match = r.data.find((a) => a.id === id);
        if (!match) throw new Error("Article not found");
        return match;
      }),
  });

  if (isLoading || !article) {
    return <div className="text-slate-400 text-sm">Loading…</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/live-kb")} className="btn-ghost py-1.5 px-2">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">{article.title}</h1>
          {(article.external_id || article.product) && (
            <p className="text-xs text-slate-500 mt-0.5">
              {[article.external_id, article.product].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <span
          className={
            article.health === "healthy"
              ? "badge-green"
              : article.health === "stale"
              ? "badge-amber"
              : "badge-red"
          }
        >
          {article.health}
        </span>
      </div>

      {article.tags?.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {article.tags.map((t) => (
            <span key={t} className="badge-blue">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="card">
        <p className="text-sm text-slate-300 whitespace-pre-wrap">{article.content}</p>
      </div>
    </div>
  );
}
