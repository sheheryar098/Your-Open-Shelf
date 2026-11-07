import type { ReactNode } from "react";
import Link from "next/link";
import { policy } from "@/server/config";
import { NOT_EXCHANGEABLE } from "@/shared/lib/vocab";

export interface PolicyDoc {
  title: string;
  summary: string;
  body: ReactNode;
}

/**
 * Policy drafts. They are placeholders for qualified
 * legal counsel to finalize per jurisdiction and must not be relied on as legal advice.
 */
export const POLICIES: Record<string, PolicyDoc> = {
  terms: {
    title: "Terms of Service",
    summary: "The agreement between you and YOS for using the platform.",
    body: (
      <>
        <h2>1. What YOS is</h2>
        <p>
          YOS is a marketplace facilitator and exchange coordinator for physical books owned by members. YOS is not the
          seller, owner, buyer or appraiser of any listed book and does not take possession of books.
        </p>
        <h2>2. Eligibility and accounts</h2>
        <p>
          You must be at least {policy.minimumAge} (or the age of digital consent where you live, if higher), provide
          accurate information, keep your password secure, and hold one account per person.
        </p>
        <h2>3. Listings</h2>
        <p>
          You may list only eligible physical books you own and can ship. Listings must follow the{" "}
          <Link href="/legal/listing-policy">Listing and Condition Policy</Link> and the{" "}
          <Link href="/legal/prohibited-items">Prohibited Items Policy</Link>.
        </p>
        <h2>4. Credits</h2>
        <p>
          Credits are governed by the <Link href="/legal/credits">Credit System Terms</Link>. They have no cash value
          and are not transferable.
        </p>
        <h2>5. Exchanges and shipping</h2>
        <p>
          Senders pay outgoing postage, ship within published deadlines and provide tracking or proof of postage. See
          the <Link href="/legal/shipping">Shipping and Customs Policy</Link>.
        </p>
        <h2>6. Conduct</h2>
        <p>
          Follow the <Link href="/legal/community-guidelines">Community Guidelines</Link>. Do not solicit off-platform
          payments, harass members, manipulate reviews, or create accounts to farm credits.
        </p>
        <h2>7. Enforcement</h2>
        <p>
          YOS may remove listings, restrict features or suspend accounts under these terms, with reasons and an appeal
          path for significant actions.
        </p>
        <h2>8. Liability</h2>
        <p>
          YOS does not guarantee carrier performance, delivery times or the condition of member books beyond the dispute
          process. [Liability terms to be drafted by counsel for each jurisdiction.]
        </p>
        <h2>9. Changes</h2>
        <p>We&apos;ll notify members of material changes before they take effect.</p>
      </>
    ),
  },
  privacy: {
    title: "Privacy Policy",
    summary: "What personal data YOS collects, why, and your rights.",
    body: (
      <>
        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Account:</strong> email, display name, password hash, country, language and time zone.
          </li>
          <li>
            <strong>Addresses:</strong> only when you save one or request a book.
          </li>
          <li>
            <strong>Exchanges:</strong> listings, requests, tracking details, messages, disputes and evidence.
          </li>
          <li>
            <strong>Technical:</strong> session records (IP address and browser) for security, and a country preference
            cookie.
          </li>
        </ul>
        <h2>How we use it</h2>
        <p>
          To run exchanges, keep the credit ledger, provide support, prevent fraud and meet legal obligations. We
          don&apos;t sell personal data.
        </p>
        <h2>Who sees it</h2>
        <p>
          Your street address is shared only with the sender of an exchange they&apos;ve accepted, for fulfilment. Staff
          access is limited to what a case needs and sensitive actions are audit-logged.
        </p>
        <h2>Location</h2>
        <p>
          We may estimate your country from network information to suggest a country on your first visit. It&apos;s only
          a suggestion: you can always change it, and it isn&apos;t treated as your residence.
        </p>
        <h2>Retention</h2>
        <p>
          Delivery addresses on closed exchanges are redacted after 60 days. Credit ledger records are retained as
          financial records. [Further retention periods to be confirmed with counsel.]
        </p>
        <h2>Your rights</h2>
        <p>
          You can download your data from <Link href="/settings/account">account settings</Link>, correct your profile,
          and close your account. Contact support for other requests.
        </p>
      </>
    ),
  },
  cookies: {
    title: "Cookie Policy",
    summary: "The small number of cookies YOS uses.",
    body: (
      <>
        <p>YOS uses only first-party cookies that are necessary to run the service:</p>
        <ul>
          <li>
            <code>yos_session</code> keeps you signed in (HTTP-only, expires after {policy.sessionDays} days).
          </li>
          <li>
            <code>yos_country</code> remembers the country you chose.
          </li>
        </ul>
        <p>
          We don&apos;t use advertising or third-party tracking cookies. If analytics are added later, we&apos;ll ask
          for consent where required.
        </p>
      </>
    ),
  },
  "listing-policy": {
    title: "Book Listing and Condition Policy",
    summary: "How to list books accurately.",
    body: (
      <>
        <p>
          Every listing must describe a single physical copy that you own and can ship, using the{" "}
          <Link href="/condition-guide">condition standard</Link>, with at least one photo of the actual copy and a
          written disclosure of any wear or defects.
        </p>
        <ul>
          <li>Confirm you have the book in your possession before publishing.</li>
          <li>Represent the edition, language and format accurately.</li>
          <li>Keep listings current. Listings not reconfirmed within {policy.staleListingDays} days are paused.</li>
          <li>List multiple copies separately; each copy can only be reserved by one member at a time.</li>
          <li>
            Catalog cover images are separate from photos of your copy; don&apos;t upload images you don&apos;t have
            rights to.
          </li>
        </ul>
      </>
    ),
  },
  credits: {
    title: "Credit System Terms",
    summary: "The rules for YOS credits.",
    body: (
      <>
        <p>
          A YOS credit is an internal, non-cash unit used to request eligible books on YOS. It is not a deposit, bank
          balance, cryptocurrency, security, gift card or promise of cash redemption. [Legal classification to be
          reviewed in each jurisdiction.]
        </p>
        <ul>
          <li>Credits are earned only for qualifying completed outgoing exchanges, once per exchange.</li>
          <li>One standard book request costs one credit, shown before you confirm.</li>
          <li>Credits are non-transferable and have no cash value. They cannot be bought or sold.</li>
          <li>Credits do not expire at launch. Any change will be announced in advance.</li>
          <li>Unused credits are not redeemable on account closure.</li>
          <li>YOS may correct or reverse credits issued in error or through abuse, with a recorded reason.</li>
        </ul>
      </>
    ),
  },
  shipping: {
    title: "Shipping and Customs Policy",
    summary: "Postage, tracking, deadlines and customs.",
    body: (
      <>
        <ul>
          <li>The sender pays outgoing postage and chooses an allowed carrier service.</li>
          <li>
            Respond to requests within {policy.senderResponseDays} days; dispatch within {policy.dispatchBusinessDays}{" "}
            business days of accepting.
          </li>
          <li>Tracking is required where the route says so; otherwise upload proof of postage.</li>
          <li>
            Cross-border senders must complete truthful customs declarations. Duties and import fees are not covered by
            credits.
          </li>
          <li>Recipients must give a complete, accurate address and report non-delivery or damage promptly.</li>
          <li>
            Unsupported routes cannot be used. See <Link href="/shipping">Countries &amp; shipping</Link>.
          </li>
        </ul>
      </>
    ),
  },
  disputes: {
    title: "Cancellation and Dispute Policy",
    summary: "What happens when an exchange doesn't go to plan.",
    body: (
      <>
        <ul>
          <li>
            <strong>Sender declines or doesn&apos;t respond:</strong> the request ends and the credit is returned.
          </li>
          <li>
            <strong>Sender accepts but doesn&apos;t dispatch in time:</strong> the exchange is cancelled, the credit
            returned, and a performance event recorded.
          </li>
          <li>
            <strong>Requester cancels before acceptance:</strong> the credit is returned.
          </li>
          <li>
            <strong>After dispatch:</strong> cancellation isn&apos;t automatic. Open a dispute or contact support.
          </li>
          <li>
            <strong>Damaged, lost or misdescribed:</strong> open a dispute within the dispute window with evidence.
            Support decides based on evidence and records the reason.
          </li>
          <li>
            <strong>Returns:</strong> there are no routine returns; remedies apply to errors and disputes.
          </li>
          <li>
            <strong>Appeals:</strong> within 14 days of a decision, via a support ticket.
          </li>
        </ul>
      </>
    ),
  },
  "prohibited-items": {
    title: "Prohibited Items Policy",
    summary: "What can't be listed on YOS.",
    body: (
      <>
        <p>YOS supports physical books only. You may not list:</p>
        <ul>
          <li>Digital downloads, e-books, codes or access keys</li>
          <li>Pirated, counterfeit or unauthorized reproductions</li>
          <li>Items prohibited by law in the origin or destination country, or by carrier rules</li>
          <li>Books you don&apos;t own or can&apos;t ship</li>
          {NOT_EXCHANGEABLE.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <p>Religious, cultural and political books are welcome, subject to neutral content rules and applicable law.</p>
      </>
    ),
  },
  "community-guidelines": {
    title: "Community Guidelines",
    summary: "How we treat each other on YOS.",
    body: (
      <>
        <ul>
          <li>Be honest about your books and kind in your messages.</li>
          <li>Keep communication about the exchange. No harassment, discrimination or threats.</li>
          <li>Never ask for or offer payment outside YOS.</li>
          <li>Leave fair, factual feedback. Don&apos;t retaliate or trade reviews.</li>
          <li>One account per person. Don&apos;t create accounts to farm credits.</li>
          <li>Respect privacy: don&apos;t share another member&apos;s address or details.</li>
        </ul>
      </>
    ),
  },
  "plus-billing": {
    title: "Premium Membership and Billing Terms",
    summary: "Terms for the future YOS Plus plan.",
    body: (
      <p>
        YOS Plus is not yet available. Billing, renewal, cancellation and refund terms will be published here before any
        paid plan launches.
      </p>
    ),
  },
  copyright: {
    title: "Copyright & Intellectual Property Complaints",
    summary: "How rights holders can report infringement.",
    body: (
      <>
        <p>
          YOS doesn&apos;t facilitate pirated or counterfeit editions. If you believe a listing or image infringes your
          rights, <Link href="/contact">contact us</Link> with:
        </p>
        <ul>
          <li>The listing link and the work concerned</li>
          <li>Your contact details and relationship to the rights holder</li>
          <li>A statement that the information is accurate</li>
        </ul>
        <p>We review complaints and may remove listings and restrict repeat infringers.</p>
      </>
    ),
  },
  retention: {
    title: "Data Retention and Deletion",
    summary: "How long YOS keeps data.",
    body: (
      <ul>
        <li>Delivery address snapshots: redacted 60 days after an exchange closes (unless a dispute is open).</li>
        <li>Saved addresses: until you delete them or close your account.</li>
        <li>
          Credit ledger: retained as an auditable financial record; linked to a pseudonymous ID after account closure.
        </li>
        <li>Messages, tracking and dispute evidence: [retention period to be confirmed with counsel].</li>
        <li>Account closure removes your profile, addresses, wish list and active listings.</li>
      </ul>
    ),
  },
};
