/**
 * Typed API client. All requests attach the Bearer token from localStorage.
 * Rule 4: Never expose backend secrets, API keys, or credentials.
 * Rule 7: All response text is treated as untrusted — callers must escape before rendering.
 */

import { getToken, clearToken } from "./auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers,
  });

  if (res.status === 401) {
    // Token expired or invalid — clear local state and redirect to login
    clearToken();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(401, "Session expired. Please log in again.");
  }

  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") {
        detail = body.detail;
      } else if (typeof body?.error?.message === "string") {
        detail = body.error.message;
      } else if (typeof body?.message === "string") {
        detail = body.message;
      }
    } catch {
      // ignore parse errors
    }
    // Safe message with backend detail when available
    throw new ApiError(res.status, detail ?? `Request failed (${res.status})`, detail);
  }

  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

// Auth
import type { LoginRequest, TokenResponse } from "./types";
export const authApi = {
  login: (data: LoginRequest) =>
    request<TokenResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  logout: () =>
    request<{ message: string }>("/api/v1/auth/logout", {
      method: "POST",
    }),
  register: (data: { email: string; password: string; full_name: string; age?: number }) =>
    request<{ id: string; email: string; full_name: string; age?: number; roles: { name: string }[]; is_active: boolean }>(
      "/api/v1/auth/register",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    ),
  me: () =>
    request<{ id: string; email: string; full_name: string; roles: { name: string }[]; is_active: boolean }>(
      "/api/v1/auth/me"
    ),
};

// Documents
import type { DocumentRead, DocumentDetailRead, PaginatedResponse } from "./types";
export const documentsApi = {
  list: (params: {
    page?: number;
    page_size?: number;
    company?: string;
    year?: number;
    document_type?: string;
    status?: string;
  }) => {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.page_size) q.set("page_size", String(params.page_size));
    if (params.company) q.set("company", params.company);
    if (params.year) q.set("year", String(params.year));
    if (params.document_type) q.set("document_type", params.document_type);
    if (params.status) q.set("status", params.status);
    return request<PaginatedResponse<DocumentRead>>(`/api/v1/documents?${q}`);
  },
  get: (id: string) => request<DocumentDetailRead>(`/api/v1/documents/${id}`),
  getSections: (id: string) =>
    request<import("./types").DocumentSectionRead[]>(`/api/v1/documents/${id}/sections`),
  getChunks: (id: string, limit: number = 100, offset: number = 0) =>
    request<import("./types").DocumentChunkRead[]>(
      `/api/v1/documents/${id}/chunks?limit=${limit}&offset=${offset}`
    ),
  getChunk: (chunkId: string) =>
    request<import("./types").DocumentChunkRead>(`/api/v1/documents/chunks/${chunkId}`),
  ingest: (id: string) =>
    request<{ job_id: string; document_id: string; status: string }>(
      `/api/v1/documents/${id}/ingest`,
      { method: "POST" }
    ),
  upload: (formData: FormData) =>
    request<{
      status: string;
      document_id: string;
      version_id?: string;
      title: string;
      organization?: string;
      document_type?: string;
      report_year?: number;
      filename: string;
      file_size?: number;
      sections_count?: number;
      chunks_count?: number;
      message: string;
    }>("/api/v1/documents/upload", {
      method: "POST",
      body: formData,
    }),
  delete: (id: string) =>
    request<{ message?: string }>(`/api/v1/documents/${id}`, {
      method: "DELETE",
    }),
};

// Search
import type { SearchRequest, SearchResponse } from "./types";
export const searchApi = {
  search: (data: SearchRequest) =>
    request<SearchResponse>("/api/v1/search", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// Chat
import type { AgentStep, ChatCitationItem, ChatRequest, ChatResponse } from "./types";

export interface StreamChatParams {
  message: string;
  conversationId?: string;
  history?: Array<{ role: string; content: string }>;
  filters?: Record<string, unknown>;
  signal?: AbortSignal;
  onStep?: (step: AgentStep) => void;
  onToken?: (token: string) => void;
  onCitation?: (citation: ChatCitationItem) => void;
  onCompleted?: (result: {
    messageId: string;
    conversationId: string;
    grounded?: boolean;
    abstained?: boolean;
    citations?: ChatCitationItem[];
  }) => void;
  onError?: (err: Error) => void;
}

export async function streamChat({
  message,
  conversationId,
  history,
  filters,
  signal,
  onStep,
  onToken,
  onCitation,
  onCompleted,
  onError,
}: StreamChatParams): Promise<void> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}/api/v1/chat/stream`, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({
      message,
      conversation_id: conversationId,
      history: history ?? null,
      filters,
    }),
    signal,
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`;
      }
    }
    const errText = await response.text().catch(() => "");
    let errorMsg = `Server streaming error (${response.status})`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed.detail) errorMsg = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
    } catch {
      if (errText) errorMsg = errText;
    }
    const err = new Error(errorMsg);
    onError?.(err);
    throw err;
  }

  if (!response.body) {
    const err = new Error("No response body available for streaming");
    onError?.(err);
    throw err;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let currentEvent = "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          currentEvent = "";
          continue;
        }

        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
          continue;
        }

        if (line.startsWith("data:")) {
          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);
            switch (currentEvent) {
              case "agent_step":
                onStep?.({
                  id: crypto.randomUUID(),
                  step: data.step || "step",
                  title: data.title || "Processing",
                  detail: data.detail || "",
                  status: data.status || "completed",
                  timestamp: Date.now(),
                });
                break;
              case "query_started":
                onStep?.({
                  id: "query_started",
                  step: "query_started",
                  title: "Initializing research pipeline",
                  detail: "Preparing context and vector search parameters...",
                  status: "in_progress",
                  timestamp: Date.now(),
                });
                break;
              case "query_classified":
                onStep?.({
                  id: "query_classified",
                  step: "query_classified",
                  title: "Query classified",
                  detail: `Identified query type: ${data.query_type || "DIRECT"}`,
                  status: "completed",
                  timestamp: Date.now(),
                });
                break;
              case "retrieval_started":
                onStep?.({
                  id: "retrieval_started",
                  step: "retrieval_started",
                  title: "Searching knowledge corpus",
                  detail: data.message || "Querying academic papers and educational datasets...",
                  status: "in_progress",
                  timestamp: Date.now(),
                });
                break;
              case "retrieval_completed":
                onStep?.({
                  id: "retrieval_completed",
                  step: "retrieval_completed",
                  title: "Evidence retrieval completed",
                  detail: `Found relevant evidence candidate chunks (${data.citations_count || 0})`,
                  status: "completed",
                  timestamp: Date.now(),
                });
                break;
              case "reranking_completed":
                onStep?.({
                  id: "reranking_completed",
                  step: "reranking_completed",
                  title: "Evidence reranked",
                  detail: "Prioritized highest relevance passages using neural cross-encoder",
                  status: "completed",
                  timestamp: Date.now(),
                });
                break;
              case "generation_started":
                onStep?.({
                  id: "generation_started",
                  step: "generation_started",
                  title: "Synthesizing answer",
                  detail: "Generating grounded response with live source citations...",
                  status: "in_progress",
                  timestamp: Date.now(),
                });
                break;
              case "token":
                if (data.token) {
                  onToken?.(data.token);
                }
                break;
              case "citation":
                if (data.citation_id || data.chunk_id) {
                  onCitation?.({
                    chunk_id: data.citation_id || data.chunk_id,
                    document_id: data.document_id ?? null,
                    citation_label: data.citation_label ?? null,
                    page: data.page ?? null,
                    evidence_text: data.evidence_text ?? null,
                  });
                }
                break;
              case "completed":
                onCompleted?.({
                  messageId: data.message_id,
                  conversationId: data.conversation_id,
                  grounded: data.grounded,
                  abstained: data.abstained,
                  citations: data.citations,
                });
                break;
              case "error":
                onError?.(new Error(data.message || data.detail || "Generation error"));
                break;
            }
          } catch (e) {
            console.error("Failed to parse SSE JSON chunk:", dataStr, e);
          }
        }
      }
    }
  } catch (err: unknown) {
    if (signal?.aborted) {
      return;
    }
    const errorObj = err instanceof Error ? err : new Error(String(err));
    onError?.(errorObj);
    throw errorObj;
  }
}

export interface FeedbackSubmission {
  message_id: string;
  conversation_id?: string;
  rating: "thumbs_up" | "thumbs_down";
  feedback_text?: string;
  tags?: string[];
  user_query?: string;
}

export interface FeedbackRecord {
  message_id: string;
  rating: "thumbs_up" | "thumbs_down" | null;
  feedback_text?: string | null;
  tags?: string[];
  created_at?: string;
}

export const chatApi = {
  chat: (data: ChatRequest) =>
    request<ChatResponse>("/api/v1/chat", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  stream: streamChat,
  /** Returns the raw response for SSE streaming — caller must handle the stream. */
  streamUrl: () => `${API_BASE}/api/v1/chat/stream`,
  submitFeedback: (data: FeedbackSubmission) =>
    request<{ status: string; feedback_id: string; message_id: string; rating: string }>("/api/v1/chat/feedback", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getMessageFeedback: (messageId: string) =>
    request<FeedbackRecord>(`/api/v1/chat/feedback/${messageId}`),
  getConversationFeedback: (conversationId: string) =>
    request<{ conversation_id: string; feedback: Record<string, FeedbackRecord> }>(
      `/api/v1/chat/conversations/${conversationId}/feedback`
    ),
  getToken,
};

import type { ConversationDetail, ConversationItem } from "./types";
export const conversationsApi = {
  list: (limit: number = 50, offset: number = 0) =>
    request<ConversationItem[]>(`/api/v1/chat/conversations?limit=${limit}&offset=${offset}`),
  get: (id: string) =>
    request<ConversationDetail>(`/api/v1/chat/conversations/${id}`),
  delete: (id: string) =>
    request<void>(`/api/v1/chat/conversations/${id}`, { method: "DELETE" }),
  trackCitationClick: (data: { chunk_id: string; conversation_id?: string; document_title?: string }) =>
    request<{ status: string; chunk_id: string }>("/api/v1/chat/citations/click", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// Ingestion jobs
import type { IngestionJobStatus } from "./types";
export const ingestionApi = {
  getJob: (jobId: string) =>
    request<IngestionJobStatus>(`/api/v1/ingestion/jobs/${jobId}`),
  listJobs: (limit: number = 50) =>
    request<IngestionJobStatus[]>(`/api/v1/ingestion/jobs?limit=${limit}`),
};

// Users (Admin only)
export interface AdminUserItem {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  created_at: string;
  roles: Array<{ id: string; name: string }>;
}

export interface UserStats {
  total_accounts: number;
  active_users: number;
  blocked_users: number;
  admin_users: number;
}

export interface PaginatedUsersResponse {
  items: AdminUserItem[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  stats: {
    total_accounts: number;
    active_users: number;
    blocked_users: number;
    admin_users: number;
  };
}

export const usersApi = {
  list: (params?: { search?: string; role?: string; status?: string; page?: number; page_size?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.role && params.role !== "all") q.set("role", params.role);
    if (params?.status && params.status !== "all") q.set("status", params.status);
    if (params?.page) q.set("page", String(params.page));
    if (params?.page_size) q.set("page_size", String(params.page_size));
    const qs = q.toString();
    return request<PaginatedUsersResponse>(`/api/v1/users${qs ? `?${qs}` : ""}`);
  },
  create: (data: { email: string; password: string; full_name?: string; role?: string }) =>
    request<AdminUserItem>("/api/v1/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateStatus: (userId: string, isActive: boolean) =>
    request<AdminUserItem>(`/api/v1/users/${userId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: isActive }),
    }),
  updateRole: (userId: string, role: string) =>
    request<AdminUserItem>(`/api/v1/users/${userId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  delete: (userId: string) =>
    request<{ message: string; id: string }>(`/api/v1/users/${userId}`, {
      method: "DELETE",
    }),
};

// Evaluations
import type { EvaluationRunRead } from "./types";
export const evaluationsApi = {
  list: (params: { page?: number; page_size?: number }) => {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.page_size) q.set("page_size", String(params.page_size));
    return request<PaginatedResponse<EvaluationRunRead>>(`/api/v1/evaluations/runs?${q}`);
  },
  get: (id: string) => request<EvaluationRunRead>(`/api/v1/evaluations/runs/${id}`),
  create: (pipeline_type: string) =>
    request<EvaluationRunRead>("/api/v1/evaluations/runs", {
      method: "POST",
      body: JSON.stringify({ pipeline_type }),
    }),
};

// Health
import type { HealthStatus, CorpusStats } from "./types";
export const healthApi = {
  qdrant: () => request<HealthStatus>("/health/qdrant"),
  redis: () => request<HealthStatus>("/health/redis"),
  llm: () => request<HealthStatus>("/health/llm"),
  stats: () => request<CorpusStats>("/health/stats"),
};

// Admin Observability & Audit Logs
export interface ObservabilityMetrics {
  status: string;
  tokens: {
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    estimated_cost_usd: number;
  };
  latencies: {
    avg_total_ms: number;
    p95_total_ms: number;
    stage_breakdown: Record<string, number>;
  };
  queries: {
    total_queries: number;
    grounded_count: number;
    abstained_count: number;
    groundedness_rate: number;
  };
  corpus: {
    total_documents: number;
    total_chunks: number;
    document_types: Record<string, number>;
  };
  recent_telemetry: Array<{
    query_id: string;
    timestamp: string;
    query_type: string;
    content_snippet: string;
    grounded: boolean;
    abstained: boolean;
    latency_ms: number;
    tokens: number;
  }>;
}

export interface AuditLogItem {
  id: string;
  user_id: string | null;
  user_email: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  ip_hash: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

export interface VulnerabilityTableRow {
  reveal: string;
  measures: string;
  capture_method: string;
  current_status: string;
  risk_assessment: string;
  metric_value: number;
  metric_unit: string;
}

export interface LongestConversationItem {
  conversation_id: string;
  anonymized_user: string;
  title: string;
  total_turns: number;
  user_turns: number;
  assistant_turns: number;
  is_struggling: boolean;
  fallbacks_encountered: number;
  first_query: string;
  last_query: string;
  started_at: string;
  last_activity: string;
}

export interface FrustrationIncidentItem {
  conversation_id: string;
  anonymized_user: string;
  signal_type: "keyword" | "repeated_query";
  matched_signal: string;
  message_snippet: string;
  timestamp: string;
  turn_index: number;
}

export interface UserCorrectionItem {
  id: string;
  message_id: string;
  conversation_id?: string;
  rating: "thumbs_down" | "thumbs_up";
  correction_text: string;
  tags: string[];
  user_query: string;
  anonymized_user: string;
  timestamp: string;
}

export interface IdkIncidentItem {
  conversation_id: string;
  anonymized_user: string;
  user_query: string;
  assistant_snippet: string;
  timestamp: string;
  abstained?: boolean;
}

export interface ConversationAnalysisResponse {
  status: string;
  summary: {
    total_conversations_analyzed: number;
    total_user_queries: number;
    total_assistant_responses: number;
    longest_conversations_count: number;
    struggling_conversations_count: number;
    frustration_incidents_count: number;
    total_citation_clicks: number;
    fallback_triggers_count: number;
    total_feedback?: number;
    thumbs_up_count?: number;
    thumbs_down_count?: number;
    satisfaction_rate?: number;
    idk_triggers_count?: number;
    idk_rate?: number;
  };
  feedback_metrics?: {
    total_feedback: number;
    thumbs_up_count: number;
    thumbs_down_count: number;
    satisfaction_rate: number;
    recent_corrections: UserCorrectionItem[];
  };
  idk_metrics?: {
    canonical_phrase: string;
    total_idk_triggers: number;
    idk_rate: number;
    idk_incidents: IdkIncidentItem[];
  };
  vulnerability_table: VulnerabilityTableRow[];
  longest_conversations: LongestConversationItem[];
  frustration_incidents: FrustrationIncidentItem[];
}

export const adminApi = {
  observability: (options?: RequestInit) => request<ObservabilityMetrics>("/api/v1/admin/observability", options),
  conversationAnalysis: (options?: RequestInit) => request<ConversationAnalysisResponse>("/api/v1/admin/conversation-analysis", options),
  auditLogs: (params: {
    action?: string;
    resource_type?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }, options?: RequestInit) => {
    const q = new URLSearchParams();
    if (params.action) q.set("action", params.action);
    if (params.resource_type) q.set("resource_type", params.resource_type);
    if (params.search) q.set("search", params.search);
    if (params.limit) q.set("limit", String(params.limit));
    if (params.offset !== undefined) q.set("offset", String(params.offset));
    return request<{ items: AuditLogItem[]; total: number; limit: number; offset: number }>(
      `/api/v1/admin/audit-logs?${q}`,
      options
    );
  },
};


