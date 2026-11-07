import { ActionForm, SubmitButton } from "./ActionForm";
import { reportAction } from "@/app/actions/support";
import { REPORT_REASONS } from "@/lib/vocab";

export function ReportForm({ targetType, targetId, label = "Report" }: { targetType: "listing" | "member" | "review" | "message"; targetId: string; label?: string }) {
  return (
    <details className="small">
      <summary className="muted">{label}</summary>
      <ActionForm action={reportAction.bind(null, targetType, targetId)} resetOnSuccess>
        <div className="field">
          <label htmlFor={`reason-${targetId}`}>Reason</label>
          <select id={`reason-${targetId}`} name="reason" required defaultValue="">
            <option value="" disabled>Choose a reason…</option>
            {Object.entries(REPORT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`details-${targetId}`}>Details (optional)</label>
          <textarea id={`details-${targetId}`} name="details" rows={3} maxLength={2000} />
        </div>
        <SubmitButton className="btn btn-sm">Send report</SubmitButton>
      </ActionForm>
    </details>
  );
}
