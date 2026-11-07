import Link from "next/link";
import { POLICIES } from "@/features/content/model/policies";

export const metadata = { title: "Policies" };

export default function LegalIndex() {
  return (
    <div className="container narrow page">
      <h1>Policies</h1>
      <div className="callout callout-warn" style={{ marginBottom: 20 }}>
        <p>These are working drafts based on the YOS operating model. They&apos;re pending review by qualified legal counsel in each market we serve.</p>
      </div>
      <div className="card">
        {Object.entries(POLICIES).map(([slug, p]) => (
          <div key={slug} className="list-item">
            <div className="body">
              <Link href={`/legal/${slug}`} className="title">{p.title}</Link>
              <div className="small muted">{p.summary}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
