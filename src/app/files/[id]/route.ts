import { NextResponse } from "next/server";
import { problem } from "@/shared/api/http";
import { canViewFile, getFile, readStored } from "@/server/domain/files";
import { currentUser } from "@/shared/api/session";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return problem("not-found");
  const row = await getFile(id);
  if (!row) return problem("not-found");
  const viewer = await currentUser();
  if (!(await canViewFile(row, viewer))) return problem("not-found");
  try {
    const buf = await readStored(row);
    const isPublic = row.kind === "listing_photo" || row.kind === "avatar";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": row.mime,
        "Content-Length": String(buf.length),
        "Cache-Control": isPublic ? "public, max-age=86400, immutable" : "private, no-store",
        "Content-Disposition": row.mime === "application/pdf" ? "inline" : "inline",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch {
    return problem("not-found");
  }
}
