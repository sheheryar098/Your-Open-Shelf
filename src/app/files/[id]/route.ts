import { NextResponse } from "next/server";
import { canViewFile, getFile, readStored } from "@/domain/files";
import { currentUser } from "@/lib/auth/session";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const row = await getFile(id);
  if (!row) return new NextResponse("Not found", { status: 404 });
  const viewer = await currentUser();
  if (!(await canViewFile(row, viewer))) return new NextResponse("Not found", { status: 404 });
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
    return new NextResponse("Not found", { status: 404 });
  }
}
