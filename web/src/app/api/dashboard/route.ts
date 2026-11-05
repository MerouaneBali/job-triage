import { NextResponse } from "next/server";
import { openAppDb } from "@/lib/dumps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type DailyBar = { date: string; count: number };
export type ScoreBucket = { label: string; count: number };
export type GapItem = { text: string; count: number };

export type DashboardData = {
  /** Overall funnel counts */
  funnel: {
    totalSeen: number;
    fetched: number;
    triaged: number;
    applyDecision: number;
    applied: number;
    waiting: number;
  };
  /** Decision breakdown */
  decisions: { apply: number; maybe: number; skip: number; none: number };
  /** Track status for jobs with decision=apply */
  applyQueue: { todo: number; applied: number; waiting: number; closed: number };
  /** Applications per calendar day (applied_at), last 60 days */
  applyByDay: DailyBar[];
  /** Fit-score buckets (0-20, 20-40 … 80-100) for decision=apply */
  scoreDistribution: ScoreBucket[];
  /** Top recurring gap items from evaluation_json across all triaged jobs */
  topGaps: GapItem[];
  /** Pipeline stage counts across dumps */
  dumpStages: { parsed: number; fetched: number; stage3: number };
  /** Easy-apply vs external split in apply pile */
  applyChannel: { easy: number; external: number; message: number; unknown: number };
};

export async function GET() {
  let db;
  try {
    db = openAppDb();
  } catch {
    return NextResponse.json({ error: "No database yet" }, { status: 404 });
  }

  try {
    // --- funnel ---
    const totalSeen = (
      db.prepare("SELECT COUNT(*) AS n FROM jobs").get() as { n: number }
    ).n;
    const fetched = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM jobs WHERE description IS NOT NULL AND length(description) > 0"
        )
        .get() as { n: number }
    ).n;
    const triaged = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM jobs WHERE decision IS NOT NULL"
        )
        .get() as { n: number }
    ).n;
    const applyDecision = (
      db
        .prepare("SELECT COUNT(*) AS n FROM jobs WHERE decision = 'apply'")
        .get() as { n: number }
    ).n;
    const applied = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM jobs WHERE track_status = 'applied' OR track_status = 'waiting'"
        )
        .get() as { n: number }
    ).n;
    const waiting = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM jobs WHERE track_status = 'waiting'"
        )
        .get() as { n: number }
    ).n;

    // --- decisions ---
    const decisionRows = db
      .prepare(
        "SELECT decision, COUNT(*) AS n FROM jobs WHERE decision IS NOT NULL GROUP BY decision"
      )
      .all() as Array<{ decision: string; n: number }>;
    const dec = Object.fromEntries(decisionRows.map((r) => [r.decision, r.n]));
    const decisions = {
      apply: dec.apply ?? 0,
      maybe: dec.maybe ?? 0,
      skip: dec.skip ?? 0,
      none: totalSeen - triaged,
    };

    // --- apply queue breakdown ---
    const qRows = db
      .prepare(
        `SELECT COALESCE(track_status, 'todo') AS ts, COUNT(*) AS n
         FROM jobs WHERE decision = 'apply'
         GROUP BY track_status`
      )
      .all() as Array<{ ts: string; n: number }>;
    const qMap = Object.fromEntries(qRows.map((r) => [r.ts, r.n]));
    const applyQueue = {
      todo: qMap.todo ?? 0,
      applied: qMap.applied ?? 0,
      waiting: qMap.waiting ?? 0,
      closed: qMap.closed ?? 0,
    };

    // --- applications by day (last 60 days) ---
    const byDay = db
      .prepare(
        `SELECT substr(applied_at, 1, 10) AS date, COUNT(*) AS count
         FROM jobs
         WHERE applied_at IS NOT NULL
           AND applied_at >= date('now', '-60 days')
         GROUP BY date ORDER BY date`
      )
      .all() as DailyBar[];

    // fill missing dates so the chart has a continuous spine
    const applyByDay: DailyBar[] = [];
    if (byDay.length > 0) {
      const dayMap = new Map(byDay.map((r) => [r.date, r.count]));
      const start = new Date(byDay[0].date);
      const end = new Date();
      for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        applyByDay.push({ date: key, count: dayMap.get(key) ?? 0 });
      }
    }

    // --- score distribution for apply pile ---
    const bucketLabels = ["0–20", "20–40", "40–60", "60–80", "80–100"];
    const scoreRows = db
      .prepare(
        `SELECT
           CASE
             WHEN fit_score IS NULL THEN -1
             WHEN fit_score < 20 THEN 0
             WHEN fit_score < 40 THEN 1
             WHEN fit_score < 60 THEN 2
             WHEN fit_score < 80 THEN 3
             ELSE 4
           END AS bucket,
           COUNT(*) AS n
         FROM jobs WHERE decision = 'apply'
         GROUP BY bucket`
      )
      .all() as Array<{ bucket: number; n: number }>;
    const bucketMap = new Map(scoreRows.map((r) => [r.bucket, r.n]));
    const scoreDistribution: ScoreBucket[] = bucketLabels.map((label, i) => ({
      label,
      count: bucketMap.get(i) ?? 0,
    }));

    // --- top gaps from evaluation_json ---
    const evalRows = db
      .prepare(
        "SELECT evaluation_json FROM jobs WHERE evaluation_json IS NOT NULL AND decision = 'apply'"
      )
      .all() as Array<{ evaluation_json: string }>;
    const gapTally = new Map<string, number>();
    for (const row of evalRows) {
      try {
        const ev = JSON.parse(row.evaluation_json) as {
          gaps?: Array<{ item?: string }>;
        };
        for (const g of ev.gaps ?? []) {
          if (!g.item) continue;
          const key = g.item.trim().toLowerCase();
          gapTally.set(key, (gapTally.get(key) ?? 0) + 1);
        }
      } catch {
        // ignore malformed
      }
    }
    const topGaps: GapItem[] = [...gapTally.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([text, count]) => ({
        text: text.charAt(0).toUpperCase() + text.slice(1),
        count,
      }));

    // --- dump stage counts ---
    const dumpParsed = (
      db.prepare("SELECT COUNT(*) AS n FROM dumps").get() as { n: number }
    ).n;
    const dumpFetched = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM dumps WHERE fetched_at IS NOT NULL"
        )
        .get() as { n: number }
    ).n;
    const dumpStage3 = (
      db
        .prepare("SELECT COUNT(*) AS n FROM dumps WHERE stage3_at IS NOT NULL")
        .get() as { n: number }
    ).n;

    // --- apply channel ---
    const chanRows = db
      .prepare(
        `SELECT COALESCE(apply_channel, 'unknown') AS ch, COUNT(*) AS n
         FROM jobs WHERE decision = 'apply'
         GROUP BY apply_channel`
      )
      .all() as Array<{ ch: string; n: number }>;
    const chanMap = Object.fromEntries(chanRows.map((r) => [r.ch, r.n]));
    const applyChannel = {
      easy: chanMap.easy_apply ?? 0,
      external: chanMap.external ?? 0,
      message: chanMap.message ?? 0,
      unknown: chanMap.unknown ?? 0,
    };

    return NextResponse.json({
      funnel: { totalSeen, fetched, triaged, applyDecision, applied, waiting },
      decisions,
      applyQueue,
      applyByDay,
      scoreDistribution,
      topGaps,
      dumpStages: { parsed: dumpParsed, fetched: dumpFetched, stage3: dumpStage3 },
      applyChannel,
    } satisfies DashboardData);
  } finally {
    db.close();
  }
}
