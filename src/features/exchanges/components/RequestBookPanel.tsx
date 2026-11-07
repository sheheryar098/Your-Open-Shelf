import Link from "next/link";
import { randomUUID } from "node:crypto";
import type { RequestOptions } from "@/server/domain/exchanges/queries";
import { policy } from "@/server/config";
import { countryName } from "@/shared/lib/countries";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { requestBookAction } from "../api/actions";

interface Props {
  listing: { id: string; status: string; credit_cost: number };
  member: { email_verified_at: Date | null; can_request: boolean } | null;
  isOwner: boolean;
  availableCredits: number;
  request: RequestOptions;
}

/** The sidebar card on a book page: the request form, or the reason a request isn't possible. */
export function RequestBookPanel({ listing, member, isOwner, availableCredits, request }: Props) {
  return <div className="card">{panelBody({ listing, member, isOwner, availableCredits, request })}</div>;
}

function panelBody({ listing, member, isOwner, availableCredits, request }: Props) {
  const addressesHref = `/settings/addresses?back=/books/${listing.id}`;

  if (isOwner) {
    return (
      <>
        <h3>This is your listing</h3>
        <p className="small">Members see the request button here.</p>
        <Link href={`/my/books/${listing.id}`} className="btn btn-block">
          Manage listing
        </Link>
      </>
    );
  }

  if (listing.status !== "active") {
    const reserved = listing.status === "reserved";
    return (
      <>
        <h3>{reserved ? "Reserved" : "Not available"}</h3>
        <p className="small">
          {reserved ? "Another member has requested this copy." : "This copy can't be requested right now."}
        </p>
      </>
    );
  }

  if (!member) {
    const blocked =
      request.countryEligibility && !request.countryEligibility.ok ? request.countryEligibility.reason : null;
    return (
      <>
        <h3>Request this book</h3>
        <p className="small">Join YOS or sign in to request books with credits.</p>
        {blocked && (
          <div className="alert alert-warn small" style={{ marginBottom: 12 }}>
            {blocked}
          </div>
        )}
        <div className="stack-sm">
          <Link href={`/signin?next=/books/${listing.id}`} className="btn btn-primary btn-block">
            Sign in to request
          </Link>
          <Link href="/signup" className="btn btn-block">
            Join YOS
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <h3>Request this book</h3>
      <div className="row-between small" style={{ marginBottom: 12 }}>
        <span>Your available credits</span>
        <strong>{availableCredits}</strong>
      </div>
      <RequestGate
        listing={listing}
        member={member}
        availableCredits={availableCredits}
        request={request}
        addressesHref={addressesHref}
      />
    </>
  );
}

function RequestGate({
  listing,
  member,
  availableCredits,
  request,
  addressesHref,
}: Omit<Props, "isOwner" | "member"> & { member: NonNullable<Props["member"]>; addressesHref: string }) {
  if (!member.email_verified_at) {
    return (
      <div className="alert alert-warn small">
        Verify your email to request books. <Link href="/verify-email">Resend link</Link>
      </div>
    );
  }
  if (!member.can_request) {
    return (
      <div className="alert alert-warn small">
        Requesting is restricted on your account. <Link href="/support/new">Contact support</Link>
      </div>
    );
  }
  if (availableCredits < listing.credit_cost) {
    return (
      <div className="alert alert-info small">
        You need 1 available credit. Earn one by <Link href="/my/books/new">listing a book</Link> and sending it to
        another member.
      </div>
    );
  }
  if (request.options.length === 0) {
    return (
      <div className="alert alert-info small">
        Add a delivery address first. <Link href={addressesHref}>Add address</Link>
      </div>
    );
  }
  if (!request.defaultAddressId) {
    const first = request.options[0].eligibility;
    return <div className="alert alert-warn small">{first.ok ? null : first.reason}</div>;
  }

  const { route } = request;
  return (
    <ActionForm action={requestBookAction.bind(null, listing.id)}>
      <input type="hidden" name="requestKey" value={randomUUID()} />
      <div className="field">
        <label htmlFor="addressId">Deliver to</label>
        <select id="addressId" name="addressId" defaultValue={request.defaultAddressId}>
          {request.options.map(({ address, eligibility }) => (
            <option key={address.id} value={address.id} disabled={!eligibility.ok}>
              {address.label ? `${address.label}: ` : ""}
              {address.city}, {countryName(address.country_code)}
              {eligibility.ok ? "" : " (not supported)"}
            </option>
          ))}
        </select>
        <span className="help">
          The sender only sees it after they accept. <Link href={addressesHref}>Manage addresses</Link>
        </span>
      </div>
      {route && (
        <div className="small stack-sm">
          <div>
            <strong>Route:</strong> {countryName(route.origin_country)} → {countryName(route.destination_country)}
          </div>
          {route.min_delivery_days != null && (
            <div>
              Usually {route.min_delivery_days} to {route.max_delivery_days} days after dispatch. Not guaranteed.
            </div>
          )}
          <div>Tracking: {route.tracking_required ? "required on this route" : "recommended"}</div>
          {route.customs_notice && <div className="callout callout-warm">{route.customs_notice}</div>}
        </div>
      )}
      <div className="callout small">
        <p>
          We hold 1 credit now. It&apos;s only spent when the exchange completes, and it comes back automatically if the
          sender declines or doesn&apos;t answer within {policy.senderResponseDays} days.
        </p>
      </div>
      <label className="check small">
        <input type="checkbox" required name="ack" />
        <span>
          I&apos;ve checked the condition, photos and route, and I agree to the{" "}
          <Link href="/legal/disputes" target="_blank">
            exchange rules
          </Link>
          .
        </span>
      </label>
      <SubmitButton className="btn btn-primary btn-block" pendingText="Requesting…">
        Request for 1 credit
      </SubmitButton>
    </ActionForm>
  );
}
