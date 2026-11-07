import Link from "next/link";
import { policy } from "@/server/config";

export const metadata = { title: "The YOS credit system" };

export default function CreditsPage() {
  return (
    <div className="container narrow page prose">
      <h1>The YOS credit system</h1>
      <p className="lede">
        A YOS credit is an internal unit for requesting books on YOS. It isn&apos;t money: it has no cash value,
        can&apos;t be bought, sold or transferred, and YOS never converts it into a currency.
      </p>

      <h2>The simple rule</h2>
      <ul>
        <li>
          <strong>One standard eligible book request costs one credit.</strong> The cost is shown before you confirm.
        </li>
        <li>
          <strong>You earn one credit</strong> for each qualifying outgoing exchange that completes, and only once per
          exchange.
        </li>
        <li>
          Credit prices don&apos;t depend on a book&apos;s retail price. Credits reward participation; YOS doesn&apos;t
          appraise books.
        </li>
      </ul>

      <h2>How credits move</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>What happens</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>You request a book</td>
              <td>
                One credit moves from <em>available</em> to <em>reserved</em>.
              </td>
            </tr>
            <tr>
              <td>
                The sender declines, doesn&apos;t respond in {policy.senderResponseDays} days, or doesn&apos;t ship in
                time
              </td>
              <td>The reserved credit is released back to your available balance automatically.</td>
            </tr>
            <tr>
              <td>You cancel before the sender accepts</td>
              <td>The reserved credit is released.</td>
            </tr>
            <tr>
              <td>The exchange completes</td>
              <td>Your reserved credit is spent, and the sender earns one credit.</td>
            </tr>
            <tr>
              <td>A dispute is decided in the requester&apos;s favour</td>
              <td>The requester&apos;s credit is restored.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>When is a credit earned?</h2>
      <ol>
        <li>The sender accepts the request.</li>
        <li>The sender dispatches within the allowed time.</li>
        <li>The sender enters valid tracking or approved proof of postage.</li>
        <li>
          Delivery is confirmed by the recipient, the carrier, support, or, for tracked parcels, when the route&apos;s
          delivery window has passed.
        </li>
        <li>
          A short {policy.disputeWindowDays}-day dispute window passes without a case being opened (skipped when the
          recipient confirms the book arrived as described).
        </li>
        <li>The credit is posted to the sender&apos;s wallet.</li>
      </ol>
      <p>Creating a listing never earns a credit by itself.</p>

      <h2>Your wallet</h2>
      <ul>
        <li>
          <strong>Available</strong>: ready to spend on a request.
        </li>
        <li>
          <strong>Reserved</strong>: held for your requests that are in progress.
        </li>
        <li>
          <strong>Pending</strong>: what you&apos;ll earn when books you&apos;ve shipped complete.
        </li>
        <li>
          <strong>History</strong>: every movement, its reason and the related exchange. Nothing changes silently.
        </li>
      </ul>

      <h2>Other rules</h2>
      <ul>
        <li>
          <strong>No welcome credits.</strong> You earn your first credit by sending a book. This keeps the exchange
          fair.
        </li>
        <li>
          <strong>No expiry</strong> at launch. Any future expiry policy would be announced well in advance and recorded
          in your history.
        </li>
        <li>
          <strong>No transfers</strong> between members, and no cash redemption.
        </li>
        <li>
          <strong>Account closure:</strong> unused credits can&apos;t be paid out. Finish or cancel in-progress
          exchanges first.
        </li>
        <li>
          <strong>Corrections:</strong> YOS staff can correct errors. Every adjustment records a reason and who made it,
          and appears in your history.
        </li>
      </ul>
      <p className="small muted">
        These rules are a draft pending legal review in each market. See the{" "}
        <Link href="/legal/credits">Credit System Terms</Link>.
      </p>
    </div>
  );
}
