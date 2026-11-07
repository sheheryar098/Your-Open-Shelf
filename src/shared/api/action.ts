import "server-only";
import { unstable_rethrow } from "next/navigation";
import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { DomainError } from "@/server/errors";

export type ActionState = { error?: string; ok?: string; at?: number } | null;

/**
 * Wraps a server action body: expected DomainErrors become a message for the form,
 * framework control flow (redirect/notFound) passes through, anything else is logged
 * and shown as a generic error.
 */
export async function run(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const ok = await fn();
    if (ok) {
      (await cookies()).set("yos_flash", `${Date.now()}|${ok}`, { path: "/", maxAge: 60, sameSite: "lax" });
    }
    refresh();
    return { ok: ok || undefined, at: Date.now() };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof DomainError) return { error: err.message, at: Date.now() };
    console.error("[action] unexpected error", err);
    return { error: "Something went wrong on our side. Please try again.", at: Date.now() };
  }
}

export function str(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
}

export function bool(fd: FormData, name: string): boolean {
  const v = fd.get(name);
  return v === "on" || v === "true" || v === "1";
}

export function files(fd: FormData, name: string): File[] {
  return fd
    .getAll(name)
    .filter((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v && (v as File).size > 0);
}

export function file(fd: FormData, name: string): File | null {
  return files(fd, name)[0] ?? null;
}
