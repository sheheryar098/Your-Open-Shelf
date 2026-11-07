"use client";

import { useEffect, useState } from "react";

/**
 * One-shot confirmation set by a server action (cookie `yos_flash`). Rendered by the root
 * layout so the message survives the form that triggered it unmounting.
 */
export function Flash({ value }: { value: string }) {
  const [open, setOpen] = useState(true);
  const message = value.slice(value.indexOf("|") + 1);
  useEffect(() => {
    document.cookie = "yos_flash=; Max-Age=0; path=/; SameSite=Lax";
    const t = setTimeout(() => setOpen(false), 8000);
    return () => clearTimeout(t);
  }, [value]);
  if (!open || !message) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Dismiss">✕</button>
    </div>
  );
}
