import Link from "next/link";
import { HELP_FAQ } from "@/features/content/model/faq";
import { FaqList } from "@/features/content/components/FaqList";

export const metadata = { title: "Help center" };

export default function Help() {
  return (
    <div className="container page">
      <div className="split">
        <div>
          <h1>Help center</h1>
          {HELP_FAQ.map((s) => (
            <section key={s.section} style={{ marginTop: 24 }}>
              <h2>{s.section}</h2>
              <FaqList items={s.items} />
            </section>
          ))}
        </div>
        <aside className="stack">
          <div className="card">
            <h3>Need a hand?</h3>
            <p className="small">For a problem with a specific exchange, open it from the exchange page so the details come with it.</p>
            <div className="stack-sm">
              <Link href="/support/new" className="btn btn-primary btn-block">Open a support ticket</Link>
              <Link href="/contact" className="btn btn-block">Contact us without an account</Link>
            </div>
            <p className="tiny muted" style={{ marginTop: 12 }}>We aim to acknowledge standard tickets within 1 business day.</p>
          </div>
          <div className="card card-flat">
            <h3>Guides</h3>
            <ul className="small">
              <li><Link href="/how-it-works">How YOS works</Link></li>
              <li><Link href="/credits">The credit system</Link></li>
              <li><Link href="/condition-guide">Book condition &amp; packing</Link></li>
              <li><Link href="/shipping">Countries, shipping &amp; customs</Link></li>
              <li><Link href="/trust-safety">Trust, safety &amp; disputes</Link></li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
