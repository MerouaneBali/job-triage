"use client";

import React, { useEffect, useState } from "react";
import { RefreshCw, TrendingUp, Briefcase, Inbox, Clock, CheckCircle2, BarChart2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DashboardData, UsageStat } from "@/app/api/dashboard/route";

// ─── pricing ──────────────────────────────────────────────────────────────────
// Rates per million tokens (MTok). Add more model slugs as needed.
const MODEL_RATES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  default:               { in: 3.00,  out: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-sonnet-5-5":   { in: 3.00,  out: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-sonnet-5":     { in: 3.00,  out: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-opus-4":       { in: 15.00, out: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  "claude-haiku-3-5":    { in: 0.80,  out: 4.00,  cacheRead: 0.08, cacheWrite: 1.00 },
};
function estimateCost(row: UsageStat): number {
  const r = MODEL_RATES[row.model] ?? MODEL_RATES.default;
  const M = 1_000_000;
  return (
    (row.inputTokens * r.in) / M +
    (row.outputTokens * r.out) / M +
    (row.cacheReadTokens * r.cacheRead) / M +
    (row.cacheWriteTokens * r.cacheWrite) / M
  );
}
function fmtCost(usd: number) {
  if (usd < 0.01) return `< $0.01`;
  return `$${usd.toFixed(2)}`;
}
function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── tiny chart primitives ────────────────────────────────────────────────────

function BarChart({
  bars,
  height = 80,
  color = "var(--color-primary, #6366f1)",
  labelEvery = 7,
}: {
  bars: { label: string; value: number }[];
  height?: number;
  color?: string;
  labelEvery?: number;
}) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  const w = 100 / bars.length;
  return (
    <svg
      viewBox={`0 0 100 ${height + 16}`}
      preserveAspectRatio="none"
      className="w-full overflow-visible"
      aria-hidden
    >
      {bars.map((b, i) => {
        const bh = (b.value / max) * height;
        const x = i * w;
        const showLabel = i % labelEvery === 0 || i === bars.length - 1;
        return (
          <g key={b.label}>
            <rect
              x={x + w * 0.1}
              y={height - bh}
              width={w * 0.8}
              height={bh}
              rx="1"
              fill={b.value > 0 ? color : "#e5e7eb"}
              className="transition-all"
            />
            {showLabel && (
              <text
                x={x + w / 2}
                y={height + 12}
                textAnchor="middle"
                fontSize="4"
                fill="currentColor"
                className="text-muted-foreground opacity-60"
              >
                {b.label.slice(5)} {/* mm-dd */}
              </text>
            )}
            {b.value > 0 && (
              <title>{`${b.label}: ${b.value}`}</title>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function DonutChart({
  slices,
  size = 80,
}: {
  slices: { label: string; value: number; color: string }[];
  size?: number;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const r = 30;
  const cx = 40;
  const cy = 40;
  let angle = -Math.PI / 2;
  const paths: React.ReactElement[] = [];

  for (const slice of slices) {
    if (slice.value === 0) continue;
    const sweep = (slice.value / total) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(angle + sweep);
    const y2 = cy + r * Math.sin(angle + sweep);
    const large = sweep > Math.PI ? 1 : 0;
    paths.push(
      <path
        key={slice.label}
        d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
        fill={slice.color}
        opacity={0.85}
      >
        <title>{`${slice.label}: ${slice.value} (${Math.round((slice.value / total) * 100)}%)`}</title>
      </path>
    );
    angle += sweep;
  }

  return (
    <svg viewBox="0 0 80 80" width={size} height={size} aria-hidden>
      {paths}
      <circle cx={cx} cy={cy} r={18} fill="white" className="dark:fill-zinc-950" />
    </svg>
  );
}

function HBar({
  value,
  max,
  color,
  label,
  count,
}: {
  value: number;
  max: number;
  color: string;
  label: string;
  count: number;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 shrink-0 truncate text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 rounded-full bg-muted" style={{ height: 6 }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="w-6 shrink-0 text-right font-mono text-muted-foreground">
        {count}
      </span>
    </div>
  );
}

// ─── stat card ────────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  sub,
  icon: Icon,
  highlight,
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon?: React.ComponentType<{ className?: string }>;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border bg-card p-4 shadow-sm",
        highlight && "border-primary/30 bg-primary/5"
      )}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </div>
      <span className="text-3xl font-bold tracking-tight">{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ─── card wrapper ─────────────────────────────────────────────────────────────

function Card({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm",
        className
      )}
    >
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error || "Failed to load dashboard");
      }
      setData((await res.json()) as DashboardData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Dashboard</h2>
          <p className="text-xs text-muted-foreground">
            Your job-search at a glance
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="min-h-11 min-w-11"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </Button>
      </div>

      {error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </p>
      ) : loading && !data ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* ── KPI strip ── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat
              label="Jobs seen"
              value={data.funnel.totalSeen}
              icon={Inbox}
              sub="across all dumps"
            />
            <Stat
              label="Descriptions"
              value={data.funnel.fetched}
              icon={BarChart2}
              sub={`${data.funnel.totalSeen > 0 ? Math.round((data.funnel.fetched / data.funnel.totalSeen) * 100) : 0}% fetched`}
            />
            <Stat
              label="Triaged"
              value={data.funnel.triaged}
              icon={TrendingUp}
              sub={`${data.funnel.fetched > 0 ? Math.round((data.funnel.triaged / data.funnel.fetched) * 100) : 0}% of fetched`}
            />
            <Stat
              label="Apply queue"
              value={data.applyQueue.todo}
              icon={Briefcase}
              sub="ready to apply"
              highlight={data.applyQueue.todo > 0}
            />
            <Stat
              label="Applied"
              value={data.funnel.applied}
              icon={CheckCircle2}
              sub={`${data.applyChannel.easy} easy · ${data.applyChannel.external} ext.`}
            />
            <Stat
              label="Waiting"
              value={data.funnel.waiting}
              icon={Clock}
              sub="awaiting reply"
              highlight={data.funnel.waiting > 0}
            />
          </div>

          {/* ── row 2: activity + pipeline funnel ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* applications over time */}
            <Card title="Applications over time" className="lg:col-span-2">
              {data.applyByDay.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No applications tracked yet. Mark jobs as applied in the Apply
                  tab to see your daily cadence here.
                </p>
              ) : (
                <>
                  <BarChart
                    bars={data.applyByDay.map((d) => ({
                      label: d.date,
                      value: d.count,
                    }))}
                    height={80}
                    labelEvery={Math.max(1, Math.ceil(data.applyByDay.length / 10))}
                  />
                  <p className="text-xs text-muted-foreground">
                    {data.applyByDay.reduce((s, d) => s + d.count, 0)} total
                    over {data.applyByDay.length} days
                  </p>
                </>
              )}
            </Card>

            {/* pipeline funnel */}
            <Card title="Pipeline stages">
              <div className="flex flex-col gap-2">
                {(
                  [
                    ["Dumps parsed", data.dumpStages.parsed, "#6366f1"],
                    ["Descriptions fetched", data.dumpStages.fetched, "#8b5cf6"],
                    ["Stage 3 triaged", data.dumpStages.stage3, "#a855f7"],
                  ] as const
                ).map(([label, count, color]) => (
                  <HBar
                    key={label}
                    label={label}
                    value={count}
                    max={data.dumpStages.parsed}
                    count={count}
                    color={color}
                  />
                ))}
                <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                  Job-level funnel
                </div>
                {(
                  [
                    ["Jobs seen", data.funnel.totalSeen, "#6366f1"],
                    ["Descriptions", data.funnel.fetched, "#8b5cf6"],
                    ["Triaged", data.funnel.triaged, "#a855f7"],
                    ["Apply decision", data.funnel.applyDecision, "#ec4899"],
                    ["Applied", data.funnel.applied, "#10b981"],
                    ["Waiting", data.funnel.waiting, "#f59e0b"],
                  ] as const
                ).map(([label, count, color]) => (
                  <HBar
                    key={label}
                    label={label}
                    value={count}
                    max={data.funnel.totalSeen}
                    count={count}
                    color={color}
                  />
                ))}
              </div>
            </Card>
          </div>

          {/* ── row 3: decision donut + score dist + top gaps ── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* decision breakdown */}
            <Card title="Decision breakdown">
              <div className="flex items-center gap-6">
                <DonutChart
                  size={90}
                  slices={[
                    { label: "Apply", value: data.decisions.apply, color: "#10b981" },
                    { label: "Maybe", value: data.decisions.maybe, color: "#f59e0b" },
                    { label: "Skip", value: data.decisions.skip, color: "#ef4444" },
                    { label: "Untriaged", value: data.decisions.none, color: "#e5e7eb" },
                  ]}
                />
                <div className="flex flex-col gap-1.5 text-xs">
                  {(
                    [
                      ["Apply", data.decisions.apply, "#10b981"],
                      ["Maybe", data.decisions.maybe, "#f59e0b"],
                      ["Skip", data.decisions.skip, "#ef4444"],
                      ["Untriaged", data.decisions.none, "#9ca3af"],
                    ] as const
                  ).map(([label, n, color]) => (
                    <div key={label} className="flex items-center gap-2">
                      <span
                        className="inline-block size-2.5 rounded-full"
                        style={{ background: color }}
                      />
                      <span className="text-muted-foreground">{label}</span>
                      <span className="ml-auto font-mono font-medium">{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* fit score distribution */}
            <Card title="Fit scores (apply pile)">
              {data.scoreDistribution.every((b) => b.count === 0) ? (
                <p className="text-sm text-muted-foreground">
                  No scored jobs yet.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.scoreDistribution.map((b) => (
                    <HBar
                      key={b.label}
                      label={b.label}
                      value={b.count}
                      max={Math.max(...data.scoreDistribution.map((x) => x.count), 1)}
                      count={b.count}
                      color="#6366f1"
                    />
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Score range 0–100 · {data.funnel.applyDecision} jobs
                  </p>
                </div>
              )}
            </Card>

            {/* top gaps */}
            <Card title="Recurring gaps (apply pile)">
              {data.topGaps.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No gap data yet. Run Stage 3 to get Claude's evaluations.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.topGaps.map((g) => (
                    <HBar
                      key={g.text}
                      label={g.text}
                      value={g.count}
                      max={data.topGaps[0]?.count ?? 1}
                      count={g.count}
                      color="#ef4444"
                    />
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Skills Claude flagged most across your apply pile
                  </p>
                </div>
              )}
            </Card>
          </div>

          {/* ── Claude Usage ───────────────────────────────────────────── */}
          {(() => {
            const totalIn = data.usage.reduce((s, r) => s + r.inputTokens, 0);
            const totalOut = data.usage.reduce((s, r) => s + r.outputTokens, 0);
            const totalCost = data.usage.reduce((s, r) => s + estimateCost(r), 0);
            const totalCalls = data.usage.reduce((s, r) => s + r.calls, 0);
            const hasData = data.usage.length > 0;

            return (
              <div className="mt-2 space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <Zap className="size-3.5" />
                  Claude Usage
                </h2>

                {/* KPI row */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="API calls" value={String(totalCalls)} icon={BarChart2} />
                  <Stat label="Input tokens" value={fmtTokens(totalIn)} icon={TrendingUp} />
                  <Stat label="Output tokens" value={fmtTokens(totalOut)} icon={TrendingUp} />
                  <Stat label="Est. cost (all time)" value={fmtCost(totalCost)} icon={Zap} />
                </div>

                {/* Daily token chart (last 30 days) */}
                <Card title="Daily tokens (last 30 days)">
                  {data.usageByDay.length > 0 ? (
                    <BarChart
                      bars={data.usageByDay.map((d) => ({
                        label: d.date.slice(5), // MM-DD
                        value: d.inputTokens + d.outputTokens,
                      }))}
                      height={70}
                      color="#8b5cf6"
                      labelEvery={7}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No usage recorded yet — tracking starts on your next Stage 3 run.
                    </p>
                  )}
                </Card>

                {/* Breakdown by model + stage */}
                <Card title="Breakdown by model & stage">
                  {hasData ? (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="pb-1.5 pr-4 font-medium">Model</th>
                              <th className="pb-1.5 pr-4 font-medium">Stage</th>
                              <th className="pb-1.5 pr-4 font-medium text-right">Calls</th>
                              <th className="pb-1.5 pr-4 font-medium text-right">Input</th>
                              <th className="pb-1.5 pr-4 font-medium text-right">Output</th>
                              <th className="pb-1.5 font-medium text-right">Est. cost</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {data.usage.map((row, i) => (
                              <tr key={i} className="text-foreground">
                                <td className="py-1.5 pr-4 font-mono">{row.model}</td>
                                <td className="py-1.5 pr-4 capitalize text-muted-foreground">{row.stage}</td>
                                <td className="py-1.5 pr-4 text-right tabular-nums">{row.calls}</td>
                                <td className="py-1.5 pr-4 text-right tabular-nums">{fmtTokens(row.inputTokens)}</td>
                                <td className="py-1.5 pr-4 text-right tabular-nums">{fmtTokens(row.outputTokens)}</td>
                                <td className="py-1.5 text-right tabular-nums font-medium">{fmtCost(estimateCost(row))}</td>
                              </tr>
                            ))}
                            <tr className="border-t font-semibold">
                              <td colSpan={2} className="pt-2 text-muted-foreground">Total</td>
                              <td className="pt-2 text-right tabular-nums">{totalCalls}</td>
                              <td className="pt-2 text-right tabular-nums">{fmtTokens(totalIn)}</td>
                              <td className="pt-2 text-right tabular-nums">{fmtTokens(totalOut)}</td>
                              <td className="pt-2 text-right tabular-nums">{fmtCost(totalCost)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Cost estimates based on published Anthropic pricing. Actual charges may differ.
                        Only tracks usage made through this tool, from this session onward.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No breakdown yet — run Stage 3 to start tracking per-model usage.
                    </p>
                  )}
                </Card>
              </div>
            );
          })()}
        </>
      ) : null}
    </div>
  );
}
