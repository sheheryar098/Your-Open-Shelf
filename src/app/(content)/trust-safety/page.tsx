import Link from "next/link";

export const metadata = { title: "Trust & safety" };

export default function TrustSafety() {
  return (
    <div className="container narrow page prose">
      <h1>Trust &amp; safety</h1>
      <p className="lede">
        YOS works because members trust that books are real, described honestly, and sent as promised.
      </p>

      <h2>Our principles</h2>
      <ul>
        <li>Accurate listings of real, member-owned books</li>
        <li>Transparent condition descriptions with actual-copy photos</li>
        <li>Clear, published credit rules with a full history in every wallet</li>
        <li>Evidence-based dispute handling, applied consistently to both members</li>
        <li>Privacy by default: only the sender of an accepted exchange sees your address</li>
        <li>Human review for consequential decisions, with an appeal path</li>
      </ul>

      <h2>Your privacy</h2>
      <p>
        Your public profile shows your display name, general country, member-since date, completed exchanges and
        ratings. Your email, phone number, street address and messages are never public. A sender sees your delivery
        address only after accepting your request, and we redact delivery addresses from closed exchanges after 60 days.
      </p>

      <h2>Reporting</h2>
      <p>
        You can report a listing, a member, a review or a message from the page where you see it. Reports go to our
        moderation team. Please report: fake or misdescribed listings, counterfeit or pirated copies, harassment,
        requests to pay outside YOS, and abusive or retaliatory reviews.
      </p>

      <h2>Disputes</h2>
      <ol>
        <li>Open a dispute from the exchange page and choose what went wrong.</li>
        <li>
          Describe the problem and upload evidence: photos of the book and packaging, tracking screenshots, carrier
          messages.
        </li>
        <li>The exchange is placed on hold, so no credit moves while the case is open.</li>
        <li>
          Support reviews the listing, messages, tracking and evidence, and may ask either member for more information.
        </li>
        <li>
          A decision is recorded with a reason, credits are adjusted under the policy, and both members are notified.
        </li>
        <li>If you disagree, you can appeal through a support ticket within 14 days.</li>
      </ol>

      <h2>Keeping the exchange fair</h2>
      <p>
        We use email verification, rate limits, limits on open requests for new members, tracking checks, and monitoring
        of the credit ledger. Risk signals lead to proportionate checks. We don&apos;t treat shared households, schools,
        libraries or public networks as fraud. Repeated failures to ship, fake tracking or credit farming can lead to
        restrictions or suspension.
      </p>

      <h2>Never pay outside YOS</h2>
      <p>
        Exchanges on YOS use credits only. If a member asks you to pay them directly, decline and{" "}
        <Link href="/help">report it</Link>.
      </p>
      <p>
        <Link href="/legal/community-guidelines">Read the Community Guidelines →</Link>
      </p>
    </div>
  );
}
