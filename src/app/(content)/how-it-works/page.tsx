import Link from "next/link";
import { policy } from "@/server/config";

export const metadata = { title: "How YOS works" };

export default function HowItWorks() {
  return (
    <div className="container narrow page prose">
      <h1>Welcome to Your Open Shelf</h1>
      <p className="lede">
        YOS helps books find their next reader. Instead of letting books sit unread, you share them with other members
        and discover something new.
      </p>

      <div className="steps" style={{ margin: "28px 0" }}>
        <div className="step">
          <h3>Join the community</h3>
          <p>Create your free account, choose your country, and set your shipping preferences.</p>
        </div>
        <div className="step">
          <h3>Add books to your shelf</h3>
          <p>
            List physical books you&apos;re ready to pass on, with the edition, language, condition and photos of your
            copy.
          </p>
        </div>
        <div className="step">
          <h3>Someone requests your book</h3>
          <p>
            A member requests it using a YOS credit. You confirm it&apos;s available and accept within{" "}
            {policy.senderResponseDays} days.
          </p>
        </div>
        <div className="step">
          <h3>Send the book</h3>
          <p>
            Pack it safely and ship it directly to the recipient within {policy.dispatchBusinessDays} business days. You
            pay the postage and add tracking or proof of postage.
          </p>
        </div>
        <div className="step">
          <h3>Earn a YOS credit</h3>
          <p>Once delivery is confirmed and the short dispute window passes, a credit lands in your wallet.</p>
        </div>
        <div className="step">
          <h3>Discover your next read</h3>
          <p>Use your credit to request an eligible book from any other member.</p>
        </div>
      </div>

      <h2>An example</h2>
      <ol>
        <li>Maya lists three books.</li>
        <li>Alex finds one of Maya&apos;s books and requests it using one credit. The credit is reserved.</li>
        <li>Maya accepts, ships the book and adds the tracking number.</li>
        <li>
          Alex confirms the book arrived as described. The exchange completes: Alex&apos;s credit is spent and Maya
          earns one.
        </li>
        <li>Maya uses that credit to request a different book from Sam, who ships it to her.</li>
      </ol>
      <p>
        Maya and Alex never had to swap directly. Credits let the whole network work, even when members want different
        books.
      </p>

      <h2>Requesting a book</h2>
      <ol>
        <li>
          Browse or search, and open a listing to check its condition, photos, format, language and where it ships from.
        </li>
        <li>Make sure you have an available credit and choose your delivery address.</li>
        <li>Review the exchange rules and any delivery or customs notes for the route, then submit.</li>
        <li>Follow status updates, track the parcel, and confirm when it arrives or report a problem.</li>
        <li>Rate the exchange.</li>
      </ol>

      <h2>Sending a book</h2>
      <ol>
        <li>You&apos;ll be notified of a new request. Review the destination and route, then accept or decline.</li>
        <li>Once you accept, you&apos;ll see the recipient&apos;s delivery address. Use it only for this exchange.</li>
        <li>
          Pack the book well (see our <Link href="/condition-guide#packing">packing guidance</Link>), pay postage and
          ship within the deadline.
        </li>
        <li>Enter the carrier and tracking number, or upload proof of postage where tracking isn&apos;t required.</li>
        <li>Receive your credit when the exchange completes.</li>
      </ol>

      <h2>When does an exchange complete?</h2>
      <p>
        If the recipient confirms the book arrived as described, the exchange completes straight away. If delivery is
        confirmed another way, for example by the carrier, or because a tracked parcel&apos;s delivery window has
        passed, there&apos;s a {policy.disputeWindowDays}-day window to report a problem before the credit is released.
        Opening a dispute pauses completion until support decides.
      </p>

      <div className="callout" style={{ marginTop: 24 }}>
        <p>
          <strong>That&apos;s YOS:</strong> one reader shares a book, another reader discovers it, and the story
          continues.
        </p>
        <p>
          <Link href="/signup" className="btn btn-primary">
            Join YOS
          </Link>
        </p>
      </div>
    </div>
  );
}
