"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

export type ActionState = { error?: string; ok?: string; at?: number } | null;
type Action = (state: ActionState, fd: FormData) => Promise<ActionState>;

export function ActionForm({
  action,
  children,
  className = "form",
  resetOnSuccess = false,
  confirm,
  encType,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
  encType?: "multipart/form-data";
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state && !state.error) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      encType={encType}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {state?.error && (
        <div className="alert alert-error" role="alert">
          {state.error}
        </div>
      )}
      {children}
    </form>
  );
}

export function SubmitButton({
  children,
  className = "btn btn-primary",
  pendingText,
  name,
  value,
}: {
  children: ReactNode;
  className?: string;
  pendingText?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending} name={name} value={value}>
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}
