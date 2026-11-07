import { NextResponse } from "next/server";
import { currentUser } from "@/shared/api/session";
import { problem, tooManyRequests } from "@/shared/api/http";
import { rateLimit } from "@/server/rate-limit";
import { exportUserData } from "@/server/domain/users";

/** GET /api/v1/me/export — data access request (§18.6): everything YOS holds about the signed-in member. */
export async function GET() {
  const u = await currentUser();
  if (!u) return problem("unauthenticated", "Sign in to download your data.");
  const r = rateLimit(`export:${u.id}`, 5, 60 * 60_000);
  if (!r.ok) return tooManyRequests(r.retryAfter, "You can download your data up to 5 times an hour.");
  const data = await exportUserData(u.id);
  return new NextResponse(JSON.stringify({ data }, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="yos-data-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
