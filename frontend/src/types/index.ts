export type CaseCategory =
  | "known_issue"
  | "configuration"
  | "confirmed_bug"
  | "feature_gap"
  | "unknown";

export type CasePriority = "critical" | "high" | "medium" | "low";

export type CaseStatus =
  | "ingested"
  | "analysing"
  | "pending_approval"
  | "approved"
  | "resolving"
  | "resolved"
  | "escalated";

export interface CaseSource {
  id: string;
  title: string;
  url?: string;
  excerpt: string;
  relevance_score: number;
  source_type: "kb_article" | "past_case" | "ado_item" | "rca_doc";
}

export interface CasePacket {
  diagnosis: string;
  category: CaseCategory;
  confidence: number;
  resolution_steps: string[];
  customer_reply: string;
  sources: CaseSource[];
  ado_item_id?: string;
  regression_test_snippet?: string;
  rca_draft?: string;
}

export interface Case {
  id: string;
  external_id?: string;
  title: string;
  description: string;
  customer?: string;
  product?: string;
  version?: string;
  priority: CasePriority;
  status: CaseStatus;
  category?: CaseCategory;
  packet?: CasePacket;
  resolution_output?: string;
  resolution_error?: string;
  regression_test_snippet?: string;
  created_at: string;
  updated_at: string;
}

export interface WorkItemDraft {
  title: string;
  type: string;
  severity: string;
  description: string;
  repro_steps: string[];
  customer_impact_count: number;
  linked_case_ids: string[];
  existing_ado_id?: string;
  confidence: number;
}

export interface WorkItemSynthesisResult {
  clusters: unknown[];
  drafts: WorkItemDraft[];
  linked_existing: number;
  new_items: number;
}

export interface KBHealthReport {
  total_articles: number;
  healthy: number;
  stale: number;
  contradictions: number;
  coverage_gaps: number;
}

export interface KBArticle {
  id: string;
  external_id?: string;
  title: string;
  content: string;
  product?: string;
  tags: string[];
  health: "healthy" | "stale" | "contradicts" | "gap";
  freshness_score: number;
}

/** Raw Azure DevOps work item, as returned by GET /api/ado/backlog and /work-items/search. */
export interface AdoWorkItem {
  id: number;
  fields: {
    "System.Title"?: string;
    "System.State"?: string;
    "System.WorkItemType"?: string;
    "System.AssignedTo"?: { displayName?: string } | string;
    "Microsoft.VSTS.Common.Severity"?: string;
    "Microsoft.VSTS.Common.Priority"?: number;
    "System.Tags"?: string;
    "System.CreatedDate"?: string;
    [key: string]: unknown;
  };
}
