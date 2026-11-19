/**
 * TypeScript types mirroring backend API response schemas.
 * Derived from BACKEND SCHEMA.md and the actual Pydantic schemas.
 * Rule 4: Never put secrets here. Rule 6: Only expose fields the UI needs.
 */

// Auth
export interface LoginRequest {
  email: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  roles: string[];
  is_active: boolean;
}

// Pagination
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

// Documents
export interface DocumentRead {
  id: string;
  title: string;
  source_type: string;
  document_type: string;
  organization: string | null;
  ticker: string | null;
  report_year: number | null;
  status: string;
  created_at: string;
}

export interface DocumentDetailRead {
  id: string;
  title: string;
  organization: string | null;
  report_year: number | null;
  document_type: string;
  status: string;
  page_count: number | null;
  chunk_count: number | null;
}

export interface DocumentSectionRead {
  id: string;
  heading: string | null;
  heading_level: number | null;
  section_order: number | null;
  page_start: number | null;
  page_end: number | null;
  path: string | null;
}

export interface DocumentChunkRead {
  id: string;
  document_version_id?: string;
  document_id?: string;
  document_title?: string;
  file_name?: string;
  chunk_index: number;
  chunk_type: string | null;
  text: string;
  page_start: number | null;
  page_end: number | null;
  heading_path: string | null;
  table_html?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Search
export interface SearchFilters {
  companies?: string[];
  years?: number[];
  document_type?: string;
}

export interface SearchRequest {
  query: string;
  filters?: SearchFilters;
  top_k?: number;
}

export interface SearchResultItem {
  chunk_id: string;
  document_id: string;
  score: number;
  text: string;
  company: string | null;
  year: number | null;
  page: number | null;
  document_title?: string | null;
  document_type?: string | null;
}

export interface SearchResponse {
  query_id: string;
  results: SearchResultItem[];
  message?: string | null;
  available_resources?: string[] | null;
}

// Chat
export interface ChatRequest {
  conversation_id?: string;
  message: string;
  filters?: Record<string, unknown>;
}

export interface ChatCitationItem {
  chunk_id: string;
  document_id: string | null;
  document_title?: string | null;
  citation_label: string | null;
  page: number | null;
  evidence_text: string | null;
}

export interface ChatResponse {
  message_id: string;
  conversation_id: string;
  answer: string;
  grounded: boolean;
  abstained: boolean;
  citations: ChatCitationItem[];
}

export interface AgentStep {
  id: string;
  step: string;
  title: string;
  detail: string;
  status: "in_progress" | "completed" | "error";
  timestamp?: number;
}

export interface ConversationItem {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends ConversationItem {
  messages: Array<{
    id: string;
    conversation_id: string;
    role: "user" | "assistant";
    content: string;
    query_type?: string | null;
    grounded?: boolean | null;
    abstained?: boolean;
    created_at: string;
    citations?: Array<{
      id: string;
      chunk_id?: string | null;
      citation_label?: string | null;
    }>;
  }>;
}


// SSE events
export type SSEEventType =
  | "agent_step"
  | "query_started"
  | "query_classified"
  | "retrieval_started"
  | "retrieval_completed"
  | "reranking_completed"
  | "generation_started"
  | "token"
  | "citation"
  | "completed"
  | "error";

export interface SSEEvent {
  type: SSEEventType;
  data: Record<string, unknown>;
}

// Ingestion
export interface IngestionJobStatus {
  job_id: string;
  document_id: string;
  document_title?: string;
  status: string;
  progress: number;
  stage: string;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

// Evaluations
export interface EvaluationMetrics {
  recall_at_5: number | null;
  recall_at_10: number | null;
  mrr: number | null;
  ndcg_at_10: number | null;
  groundedness: number | null;
  citation_accuracy: number | null;
  citation_completeness: number | null;
  abstention_accuracy: number | null;
  mean_latency_ms: number | null;
}

export interface EvaluationRunRead {
  id: string;
  evaluation_set_id: string | null;
  status: string;
  pipeline_type: string | null;
  configuration: Record<string, unknown> | null;
  metrics: EvaluationMetrics | null;
  started_at: string;
  finished_at: string | null;
}

// Health
export interface HealthStatus {
  status: string;
  service: string;
  connected?: boolean;
  latency_ms?: number;
  timestamp: string;
}

// Corpus Stats (from /health/stats)
export interface CorpusStats {
  total_documents: number;
  ready_documents: number;
  total_chunks: number;
  total_queries: number;
  timestamp: string;
}
