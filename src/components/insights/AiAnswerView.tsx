import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AiInsightsAnswerBlock, AiInsightsTurnResponse } from "@/types/insights";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const CHART_COLORS = [
  "hsl(var(--brand-accent))",
  "hsl(var(--tone-pending))",
  "hsl(var(--tone-success))",
];

function toAssistantLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function toFallbackBlocks(payload: AiInsightsTurnResponse): AiInsightsAnswerBlock[] {
  const blocks: AiInsightsAnswerBlock[] = [];

  if (
    payload.visual?.type === "table" &&
    Array.isArray(payload.visual.columns) &&
    Array.isArray(payload.visual.rows) &&
    payload.visual.rows.length > 0
  ) {
    blocks.push({
      id: "fallback-table",
      type: "table",
      priority: 30,
      source: "workspace_data",
      title: payload.visual.title ?? "Evidence Table",
      payload: {
        columns: payload.visual.columns,
        rows: payload.visual.rows,
      },
    });
  }

  if (
    (payload.visual?.type === "line" || payload.visual?.type === "bar") &&
    typeof payload.visual.x === "string" &&
    Array.isArray(payload.visual.y) &&
    Array.isArray(payload.visual.rows) &&
    payload.visual.rows.length > 0
  ) {
    blocks.push({
      id: "fallback-visual",
      type: payload.visual.type === "bar" ? "bar_chart" : "line_chart",
      priority: 20,
      source: "workspace_data",
      title: payload.visual.title ?? "Evidence Chart",
      payload: {
        x: payload.visual.x,
        y: payload.visual.y,
        rows: payload.visual.rows,
      },
    });
  }

  if ((payload.recommendations?.length ?? 0) > 0) {
    blocks.push({
      id: "fallback-recommendations",
      type: "recommendations",
      priority: 25,
      source: "workspace_data",
      title: "Recommendations",
      payload: {
        items: payload.recommendations,
      },
    });
  }

  if ((payload.citations?.length ?? 0) > 0) {
    blocks.push({
      id: "fallback-citations",
      type: "citations",
      priority: 80,
      source: "workspace_data",
      title: "Sources",
      payload: {
        items: payload.citations,
      },
    });
  }

  return blocks;
}

function formatValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  if (value == null) return "-";
  return String(value);
}

function renderSupportBlock(block: AiInsightsAnswerBlock) {
  if (block.type === "recommendations") {
    const items = Array.isArray((block.payload as { items?: unknown }).items)
      ? ((block.payload as { items?: unknown[] }).items ?? [])
      : [];
    return (
      <Card key={block.id}>
        <CardHeader>
          <CardTitle>{block.title ?? "Recommendations"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((item, idx) => {
            const record = (item ?? {}) as Record<string, unknown>;
            return (
              <div key={`${block.id}-${idx}`} className="space-y-1">
                <p className="text-sm font-semibold">{String(record.title ?? record.action ?? `Recommendation ${idx + 1}`)}</p>
                {record.rationale ? <p className="text-sm text-muted-foreground">{String(record.rationale)}</p> : null}
              </div>
            );
          })}
        </CardContent>
      </Card>
    );
  }

  if (block.type === "line_chart" || block.type === "bar_chart") {
    const payload = block.payload as {
      x?: string;
      y?: string[];
      rows?: Array<Record<string, string | number | null>>;
    };
    const x = payload.x ?? "";
    const y = payload.y ?? [];
    const rows = payload.rows ?? [];
    return (
      <Card key={block.id}>
        <CardHeader>
          <CardTitle>{block.title ?? "Chart"}</CardTitle>
        </CardHeader>
        <CardContent className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            {block.type === "bar_chart" ? (
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey={x} />
                <YAxis />
                <Tooltip />
                {y.map((column, idx) => (
                  <Bar key={`${block.id}-${column}`} dataKey={column} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </BarChart>
            ) : (
              <LineChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey={x} />
                <YAxis />
                <Tooltip />
                {y.map((column, idx) => (
                  <Line
                    key={`${block.id}-${column}`}
                    type="monotone"
                    dataKey={column}
                    stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </CardContent>
      </Card>
    );
  }

  return null;
}

function renderEvidenceBlock(block: AiInsightsAnswerBlock) {
  if (block.type === "citations") {
    const items = Array.isArray((block.payload as { items?: unknown }).items)
      ? ((block.payload as { items?: unknown[] }).items ?? [])
      : [];
    return (
      <Card key={block.id}>
        <CardHeader>
          <CardTitle>Sources</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((item, idx) => {
            const record = (item ?? {}) as Record<string, unknown>;
            return (
              <div key={`${block.id}-${idx}`}>
                <p className="text-sm font-semibold">{String(record.title ?? `Source ${idx + 1}`)}</p>
                {record.publisher ? <p className="text-sm text-muted-foreground">{String(record.publisher)}</p> : null}
              </div>
            );
          })}
        </CardContent>
      </Card>
    );
  }

  if (block.type === "table") {
    const payload = block.payload as {
      columns?: string[];
      rows?: Array<Record<string, unknown>>;
    };
    const columns = payload.columns ?? [];
    const rows = payload.rows ?? [];
    return (
      <Card key={block.id}>
        <CardHeader>
          <CardTitle>{block.title ?? "Evidence Table"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column}>{toAssistantLabel(column)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 12).map((row, index) => (
                <TableRow key={`${block.id}-${index}`}>
                  {columns.map((column) => (
                    <TableCell key={`${block.id}-${index}-${column}`}>{formatValue(row[column])}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }

  return null;
}

type AiAnswerViewProps = {
  payload: AiInsightsTurnResponse;
  onUseQuestion: (question: string) => void;
};

export function AiAnswerView({ payload, onUseQuestion }: AiAnswerViewProps) {
  const [showEvidence, setShowEvidence] = useState(false);
  const blocks = useMemo(() => {
    const explicit = Array.isArray(payload.answer_blocks) ? payload.answer_blocks : [];
    const fallback = explicit.length > 0 ? [] : toFallbackBlocks(payload);
    return [...explicit, ...fallback].sort((a, b) => a.priority - b.priority);
  }, [payload]);

  const visibleArtifactIds = Array.isArray((payload.render_hints as { visible_artifact_ids?: unknown } | undefined)?.visible_artifact_ids)
    ? (((payload.render_hints as { visible_artifact_ids?: string[] }).visible_artifact_ids) ?? [])
    : [];

  const supportBlocks = blocks.filter((block) => visibleArtifactIds.includes(block.id));
  const evidenceBlocks = blocks.filter((block) => !visibleArtifactIds.includes(block.id) && (block.type === "table" || block.type === "citations"));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="space-y-3">
          {payload.answer_title ? <CardTitle>{payload.answer_title}</CardTitle> : null}
          <div className="space-y-3">
            <p className="text-[15px] leading-7 text-foreground/90">{payload.executive_answer}</p>
            {payload.why_this_matters ? (
              <p className="text-sm leading-6 text-muted-foreground">{payload.why_this_matters}</p>
            ) : null}
          </div>
        </CardHeader>
        {payload.follow_up_questions.length > 0 ? (
          <CardContent className="flex flex-wrap gap-2">
            {payload.follow_up_questions.slice(0, 3).map((question) => (
              <Button key={question} variant="outline" size="sm" onClick={() => onUseQuestion(question)}>
                {question}
              </Button>
            ))}
          </CardContent>
        ) : null}
      </Card>

      {supportBlocks.map((block) => renderSupportBlock(block))}

      {evidenceBlocks.length > 0 ? (
        <div className="space-y-3">
          <Button variant="outline" onClick={() => setShowEvidence((current) => !current)}>
            {showEvidence ? "Hide evidence" : "Show evidence"}
          </Button>
          {showEvidence ? <div className="space-y-4">{evidenceBlocks.map((block) => renderEvidenceBlock(block))}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
