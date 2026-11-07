import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runJobs } from "@/domain/jobs";

/** Scheduled processing entry point for an external cron (POST with header x-jobs-secret). */
export async function POST(req: Request) {
  const secret = process.env.JOBS_SECRET;
  const given = req.headers.get("x-jobs-secret") ?? "";
  if (!secret || secret === "change-me" || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runJobs();
  return NextResponse.json({ ok: true, result });
}
