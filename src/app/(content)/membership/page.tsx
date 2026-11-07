import Link from "next/link";
import { policy } from "@/server/config";

export const metadata = { title: "Membership" };

export default function Membership() {
  return (
    <div className="container page">
      <div className="narrow">
        <h1>Membership</h1>
        <p className="lede">The core exchange is free. A future optional plan will add convenience — never a way around the credit rules.</p>
      </div>
      <div className="grid-2" style={{ marginTop: 24 }}>
        <div className="card">
          <div className="row-between"><h2 className="mb-0">Free</h2><span className="badge badge-ok">Available now</span></div>
          <ul>
            <li>Browse and search every listing</li>
            <li>List up to {policy.activeListingLimit.free} active books</li>
            <li>Earn and spend credits</li>
            <li>Request books on supported routes</li>
            <li>Wish list with availability alerts</li>
            <li>Disputes, reporting and standard support</li>
          </ul>
          <Link href="/signup" className="btn btn-primary">Join for free</Link>
        </div>
        <div className="card">
          <div className="row-between"><h2 className="mb-0">YOS Plus</h2><span className="badge">Coming later</span></div>
          <p className="muted">Planned convenience features, to be tested with members before launch:</p>
          <ul>
            <li>Higher active-listing allowance</li>
            <li>More saved searches and advanced alerts</li>
            <li>Personal exchange statistics</li>
            <li>Profile customization and early access</li>
          </ul>
          <p className="small muted">
            YOS Plus won&apos;t include extra credits, and safety, disputes, account access and your credit records will always be
            available on the free plan.
          </p>
        </div>
      </div>
    </div>
  );
}
