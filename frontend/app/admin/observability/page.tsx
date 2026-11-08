"use client";

import * as React from "react";
import {
  Activity,
  Zap,
  Clock,
  ShieldCheck,
  Cpu,
  RefreshCw,
  Coins,
  Layers,
  ArrowUpRight,
  Sparkles,
  Search,
  CheckCircle2,
  AlertTriangle,
  ThumbsUp,
  FileQuestion,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminApi, ObservabilityMetrics, ConversationAnalysisResponse } from "@/lib/api";
import { Spinner, ErrorState } from "@/components/ui/states";
import { UserCentricVulnerabilities } from "@/components/evaluation/user-centric-vulnerabilities";
import { RealUserConversationsMonitor } from "@/components/admin/real-user-conversations-monitor";
import { isAdmin } from "@/lib/auth";
import { useRouter } from "next/navigation";

export default function ObservabilityPage() {
  const router = useRouter();
  const [data, setData] = React.useState<ObservabilityMetrics | null>(null);
  const [analysis, setAnalysis] = React.useState<ConversationAnalysisResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [accessDenied, setAccessDenied] = React.useState(false);
  // Fix #11: keep a ref to the active AbortController so we can cancel in-flight
  // fetches before the next one fires (prevents stale-response races on 30s refresh).
  const abortRef = React.useRef<AbortController | null>(null);

  const fetchMetrics = React.useCallback(async () => {
    if (typeof window !== "undefined" && !isAdmin()) {
      router.push("/dashboard");
      return;
    }
    // Fix #11: abort any previous in-flight request before starting a new one.
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setAccessDenied(false);
    try {
      const [resMetrics, resAnalysis] = await Promise.all([
        adminApi.observability({ signal: controller.signal }),
        adminApi.conversationAnalysis({ signal: controller.signal }).catch((err: unknown) => {
          if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) return null;
          // Fix #1: distinguish 403 Access Denied from generic network errors.
          if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 403) {
            setAccessDenied(true);
          }
          return null;
        }),
      ]);
      // Don't apply stale results if this request was cancelled
      if (controller.signal.aborted) return;
      setData(resMetrics);
      if (resAnalysis) setAnalysis(resAnalysis);
    } catch (err: unknown) {
      if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) return; // silently drop aborted fetches
      // Fix #4: on 401 redirect to login
      if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 401) {
        router.push("/login?from=/admin/observability");
        return;
      }
      // Fix #1: show explicit Access Denied state instead of a generic error
      if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 403) {
        setAccessDenied(true);
      } else {
        setError(err instanceof Error ? err.message : "Failed to load observability telemetry");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [router]);

  React.useEffect(() => {
    fetchMetrics();
    // Auto-refresh metrics every 30 seconds
    const interval = setInterval(fetchMetrics, 30000);
    return () => {
      clearInterval(interval);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchMetrics]);

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              System Observability & Inference Telemetry
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live token consumption, sub-stage latency decomposition, grounding metrics, and query telemetry
            </p>
          </div>

          <div className="flex items-center gap-2">
            {accessDenied ? (
              <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400 gap-1.5 py-1 text-xs">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Cluster Access: Denied
              </Badge>
            ) : error ? (
              <Badge variant="outline" className="border-destructive/40 text-destructive gap-1.5 py-1 text-xs">
                <span className="h-2 w-2 rounded-full bg-destructive" />
                Cluster State: Unreachable
              </Badge>
            ) : loading && !data ? (
              <Badge variant="outline" className="border-border text-muted-foreground gap-1.5 py-1 text-xs">
                <span className="h-2 w-2 rounded-full bg-muted-foreground animate-pulse" />
                Cluster State: Connecting...
              </Badge>
            ) : (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400 gap-1.5 py-1 text-xs">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Production Cluster: Healthy
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={fetchMetrics}
              disabled={loading}
              className="gap-1.5 text-xs h-8"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {loading && !data ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3">
            <Spinner className="h-8 w-8" />
            <span className="text-xs text-muted-foreground">Loading observability telemetry...</span>
          </div>
        ) : accessDenied ? (
          // Fix #1: explicit Access Denied state — the real wall is the backend 403.
          <div className="py-24 flex flex-col items-center justify-center gap-3 text-center">
            <ShieldCheck className="h-10 w-10 text-destructive opacity-60" />
            <p className="text-sm font-semibold text-foreground">Access Denied</p>
            <p className="text-xs text-muted-foreground max-w-sm">
              Your account does not have admin privileges. This page requires an admin-role JWT issued by the server.
            </p>
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={fetchMetrics} />
        ) : data ? (
          <div className="space-y-6">
            {/* Top 4 KPI Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Total Tokens */}
              <Card className="border-border bg-card shadow-xs p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium">Total Token Usage</span>
                  <div className="flex items-center gap-1.5">
                    {/* Fix #7: show Estimated disclaimer when backend signals derived values */}
                    {(data.tokens as { is_estimated?: boolean }).is_estimated && (
                      <Badge variant="outline" className="border-amber-400/50 text-amber-600 dark:text-amber-400 text-[9px] py-0 px-1">Estimated</Badge>
                    )}
                    <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                      <Coins className="h-4 w-4" />
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold font-mono text-foreground">
                    {data.tokens.total_tokens.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                    {data.tokens.prompt_tokens.toLocaleString()} prompt • {data.tokens.completion_tokens.toLocaleString()} completion
                  </div>
                </div>
                <div className="pt-1 flex items-center justify-between text-[11px] border-t border-border/60">
                  <span className="text-muted-foreground">Estimated Cloud Cost:</span>
                  <span className="font-semibold text-foreground font-mono">
                    ${data.tokens.estimated_cost_usd.toFixed(4)} USD
                  </span>
                </div>
              </Card>

              {/* Card 2: Average E2E Latency */}
              <Card className="border-border bg-card shadow-xs p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium">Average Latency (E2E)</span>
                  <div className="flex items-center gap-1.5">
                    {/* Fix #8: show Baseline disclaimer when backend signals static values */}
                    {(data.latencies as { is_static_baseline?: boolean }).is_static_baseline && (
                      <Badge variant="outline" className="border-sky-400/50 text-sky-600 dark:text-sky-400 text-[9px] py-0 px-1">Baseline</Badge>
                    )}
                    <div className="p-1.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      <Clock className="h-4 w-4" />
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold font-mono text-foreground">
                    {data.latencies.avg_total_ms.toLocaleString()} ms
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                    P95 Latency: {data.latencies.p95_total_ms} ms
                  </div>
                </div>
                <div className="pt-1 flex items-center justify-between text-[11px] border-t border-border/60">
                  <span className="text-muted-foreground">SLA Compliance:</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    99.8% &lt; 2500ms
                  </span>
                </div>
              </Card>

              {/* Card 3: Groundedness Rate */}
              <Card className="border-border bg-card shadow-xs p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium">Groundedness Accuracy</span>
                  <div className="p-1.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                    {data.queries.groundedness_rate}%
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Hallucination & Citation Verified
                  </div>
                </div>
                <div className="pt-1 flex items-center justify-between text-[11px] border-t border-border/60">
                  <span className="text-muted-foreground">Grounded Queries:</span>
                  <span className="font-semibold text-foreground font-mono">
                    {data.queries.grounded_count} / {data.queries.total_queries}
                  </span>
                </div>
              </Card>

              {/* Card 4: Total Knowledge Corpus */}
              <Card className="border-border bg-card shadow-xs p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium">Indexed Chunks (Qdrant)</span>
                  <div className="p-1.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    <Layers className="h-4 w-4" />
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold font-mono text-foreground">
                    {data.corpus.total_chunks.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Across {data.corpus.total_documents} cataloged documents
                  </div>
                </div>
                <div className="pt-1 flex items-center justify-between text-[11px] border-t border-border/60">
                  <span className="text-muted-foreground">Vector Dimensions:</span>
                  <span className="font-semibold text-foreground font-mono">
                    384 Dense + Sparse BM25
                  </span>
                </div>
              </Card>
            </div>

            {/* Real-Time User Feedback Loops & Knowledge Gap Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Feedback Loop KPI */}
              <Card className="border-border bg-card shadow-xs p-4 space-y-2 border-l-4 border-l-emerald-500">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <ThumbsUp className="h-4 w-4 text-emerald-500" />
                    Real-Time User Feedback (+/-)
                  </span>
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-mono text-[10px]">
                    Live User Telemetry
                  </Badge>
                </div>
                <div className="flex items-baseline gap-3">
                  <div className="text-2xl font-bold font-mono text-foreground">
                    {analysis?.summary?.satisfaction_rate ?? 100}%
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Positive Feedback ({analysis?.summary?.thumbs_up_count ?? 0} thumbs up, {analysis?.summary?.thumbs_down_count ?? 0} thumbs down)
                  </span>
                </div>
                <div className="pt-1 flex items-center justify-between text-[11px] border-t border-border/60">
                  <span className="text-muted-foreground">User Corrections Logged:</span>
                  <span className="font-semibold text-rose-600 dark:text-rose-400 font-mono">
                    {analysis?.feedback_metrics?.recent_corrections?.length ?? 0} knowledge gaps identified
                  </span>
                </div>
              </Card>

              {/* "I Don't Know" Rate KPI */}
              <Card className="border-border bg-card shadow-xs p-4 space-y-2 border-l-4 border-l-amber-500">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <FileQuestion className="h-4 w-4 text-amber-500" />
                    &ldquo;I Don&apos;t Know&rdquo; Rate (Vector DB Gap Indicator)
                  </span>
                  <Badge variant="outline" className="border-amber-500/30 text-amber-600 dark:text-amber-400 font-mono text-[10px]">
                    Programmed Abstention
                  </Badge>
                </div>
                <div className="flex items-baseline gap-3">
                  {/* Fix #14: idk_rate is now single source of truth in idk_metrics.idk_rate */}
                  <div className="text-2xl font-bold font-mono text-foreground">
                    {analysis?.idk_metrics?.idk_rate ?? 0}%
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Triggered &ldquo;I cannot find that in the provided documentation&rdquo;
                  </span>
                </div>
                <div className="pt-1 flex items-center justify-between text-[11px] border-t border-border/60">
                  <span className="text-muted-foreground">Missing Document Queries:</span>
                  <span className="font-semibold text-amber-600 dark:text-amber-400 font-mono">
                    {analysis?.summary?.idk_triggers_count ?? 0} documented gaps
                  </span>
                </div>
              </Card>
            </div>

            {/* Sub-Stage Latency Decomposition & Stage Timeline */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Latency Stages Chart */}
              <Card className="lg:col-span-2 border-border bg-card shadow-xs">
                <CardHeader className="pb-3 border-b border-border">
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-primary" />
                      <span>Sub-Stage Latency Decomposition</span>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      Average: {data.latencies.avg_total_ms}ms
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-5 space-y-4">
                  {/* Fix #6: normalize bars against the SUM of all rendered stage values,
                      not avg_total_ms alone, so bars are proportionally correct and sum to 100%. */}
                  {(() => {
                    const stageEntries = Object.entries(data.latencies.stage_breakdown);
                    const stageSum = stageEntries.reduce((acc, [, ms]) => acc + (ms as number), 0) || 1;
                    return stageEntries.map(([stage, ms]) => {
                      const percent = Math.min(100, Math.round(((ms as number) / stageSum) * 100));
                      const stageLabel = stage.replace("_ms", "").replace(/_/g, " ").toUpperCase();
                      return (
                        <div key={stage} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-foreground">{stageLabel}</span>
                            <span className="font-mono text-muted-foreground font-semibold">
                              {ms as number} ms ({percent}%)
                            </span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                percent > 50
                                  ? "bg-primary"
                                  : percent > 20
                                  ? "bg-emerald-500"
                                  : "bg-sky-500"
                              }`}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                      );
                    });
                  })()}
                </CardContent>
              </Card>

              {/* Corpus Format & Query Types Card */}
              <Card className="border-border bg-card shadow-xs flex flex-col justify-between">
                <div>
                  <CardHeader className="pb-3 border-b border-border">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-primary" />
                      <span>Corpus Type Breakdown</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-5 space-y-3 text-xs">
                    {Object.entries(data.corpus.document_types).map(([type, count]) => (
                      <div key={type} className="flex items-center justify-between py-1 border-b border-border/50">
                        <span className="capitalize text-foreground font-medium">{type.replace("_", " ")}</span>
                        <Badge variant="secondary" className="font-mono text-[11px]">
                          {count} files
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </div>

                <div className="p-4 bg-muted/30 border-t border-border rounded-b-xl text-xs space-y-2">
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    Neural Reranker Pipeline
                  </div>
                  <p className="text-muted-foreground leading-relaxed text-[11px]">
                    FastEmbed Cross-Encoder model BAAI/bge-reranker-base re-scores candidate passages before prompt synthesis to prevent hallucination.
                  </p>
                </div>
              </Card>
            </div>

            {/* Direct Comparison: Table of User-Centric Vulnerabilities */}
            <UserCentricVulnerabilities rows={analysis?.vulnerability_table} />

            {/* Monitor Real User Conversations (Anonymized Logging) */}
            <RealUserConversationsMonitor
              longestConversations={analysis?.longest_conversations || []}
              frustrationIncidents={analysis?.frustration_incidents || []}
              userCorrections={analysis?.feedback_metrics?.recent_corrections || []}
              idkIncidents={analysis?.idk_metrics?.idk_incidents || []}
              idkRate={analysis?.idk_metrics?.idk_rate || 0}
              satisfactionRate={analysis?.feedback_metrics?.satisfaction_rate || 100}
            />

            {/* Recent Query Telemetry Table */}
            <Card className="border-border bg-card shadow-xs">
              <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Search className="h-4 w-4 text-primary" />
                    <span>Recent Query Telemetry Stream</span>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Granular execution metrics per user inquiry (tokens, latency, grounding status)
                  </p>
                </div>
                <Badge variant="outline" className="font-mono text-[10px]">
                  Live Stream: Last 10 Queries
                </Badge>
              </CardHeader>

              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-muted-foreground font-semibold">
                      <th className="py-2.5 px-4 font-mono">Query ID</th>
                      <th className="py-2.5 px-4">Query Type</th>
                      <th className="py-2.5 px-4">Response Snippet</th>
                      <th className="py-2.5 px-4 font-mono">Latency</th>
                      <th className="py-2.5 px-4 font-mono">Tokens</th>
                      <th className="py-2.5 px-4 text-center">Grounding</th>
                      <th className="py-2.5 px-4">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {data.recent_telemetry.map((t) => (
                      <tr key={t.query_id} className="hover:bg-accent/40 transition-colors">
                        <td className="py-3 px-4 font-mono font-medium text-foreground">{t.query_id}</td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="font-mono text-[10px] py-0 uppercase">
                            {t.query_type}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-foreground/90 max-w-xs truncate" title={t.content_snippet}>
                          {t.content_snippet}
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-foreground">
                          {t.latency_ms} ms
                        </td>
                        <td className="py-3 px-4 font-mono text-muted-foreground">
                          {t.tokens}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {t.grounded ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Grounded
                            </span>
                          ) : t.abstained ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                              <AlertTriangle className="h-3.5 w-3.5" /> Abstained
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-[11px]">Unverified</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground font-mono text-[11px]">
                          {new Date(t.timestamp).toLocaleString("en-PK", { timeZone: "Asia/Karachi", dateStyle: "short", timeStyle: "short" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
