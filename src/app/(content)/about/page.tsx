import Link from "next/link";

export const metadata = { title: "About YOS" };

export default function About() {
  return (
    <div className="container narrow page prose">
      <h1>About YOS</h1>
      <p className="lede">Our vision: a trusted global community where physical books keep finding new readers.</p>
      <h2>Our mission</h2>
      <p>Make it simple, affordable and enjoyable for people to pass books on, discover new reads, and take part in a circular reading economy.</p>
      <h2>What YOS is — and isn&apos;t</h2>
      <p>
        For readers who have books they&apos;re ready to pass on, and readers looking for their next book, YOS is a
        community-powered exchange that connects members through a transparent credit system.
      </p>
      <ul>
        <li>YOS is <strong>not a bookstore</strong>. We don&apos;t buy, own, store, appraise or authenticate books.</li>
        <li>Members keep and ship their own books. YOS provides discovery, listings, the credit ledger, exchange coordination, tracking fields, trust and safety, and support.</li>
        <li>We don&apos;t run a warehouse, inspect books before shipment, or control carriers.</li>
      </ul>
      <h2>Global from day one — carefully</h2>
      <p>
        YOS welcomes readers everywhere, but we only enable shipping routes we&apos;ve checked for carriers, tracking, customs and
        support. We&apos;d rather tell you a route isn&apos;t supported yet than take a request we can&apos;t fulfil well.
      </p>
      <p><Link href="/shipping">See where YOS works today →</Link></p>
    </div>
  );
}
