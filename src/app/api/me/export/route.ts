import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { exportUserData } from "@/domain/users";

/** Data access request (§18.6): a member downloads everything YOS holds about them. */
export async function GET() {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const data = await exportUserData(u.id);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="yos-data-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
