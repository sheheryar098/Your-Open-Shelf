import { notFound } from "next/navigation";
import { recentOutboxEmails } from "@/server/queries/site";
import { devOutboxEnabled } from "@/server/config";
import { fmtDateTime } from "@/shared/lib/format";

export const metadata = { title: "Development outbox", robots: { index: false } };

/** Development-only view of queued email so verification and reset links can be used locally. */
export default async function Outbox() {
  if (!devOutboxEnabled()) notFound();
  const mails = await recentOutboxEmails();
  return (
    <div className="container page">
      <h1>Development outbox</h1>
      <p className="muted">Emails YOS would have sent. Disabled in production.</p>
      <div className="stack">
        {mails.map((m) => (
          <div key={m.id} className="card card-flat">
            <div className="row-between">
              <strong>{m.subject}</strong>
              <span className="small muted">
                to {m.to_email} · {fmtDateTime(m.created_at)}
              </span>
            </div>
            <pre className="small" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {linkify(m.body_text)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function linkify(text: string) {
  return text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part.replace(/^https?:\/\/[^/]+/, "")}>
        {part}
      </a>
    ) : (
      part
    ),
  );
}
