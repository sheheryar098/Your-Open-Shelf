import Link from "next/link";
import { notFound } from "next/navigation";
import { getListingDetail } from "@/server/domain/listings";
import { reachableDestinations } from "@/server/domain/routes";
import { publicProfile } from "@/server/domain/support";
import { requestOptions } from "@/server/domain/exchanges/queries";
import { availableCredits, isOnWishlist } from "@/server/queries/member";
import { can } from "@/server/rbac";
import { currentUser } from "@/shared/api/session";
import { chosenCountry } from "@/shared/api/geo";
import { formatPostageRange } from "@/shared/lib/countries";
import { authorsText } from "@/shared/lib/format";
import { isUuid } from "@/shared/lib/ids";
import { ConditionNotes, ListingFacts, ListingGallery } from "@/features/listings/components/ListingDetails";
import { OwnerCard } from "@/features/listings/components/OwnerCard";
import { WishlistCard } from "@/features/listings/components/WishlistCard";
import { RequestBookPanel } from "@/features/exchanges/components/RequestBookPanel";
import { ReportForm } from "@/features/support/components/ReportForm";

const HIDDEN_STATUSES = new Set(["draft", "removed", "under_review"]);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = isUuid(id) ? await getListingDetail(id) : null;
  return { title: listing ? `${listing.title} by ${authorsText(listing.authors)}` : "Book" };
}

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [listing, user] = await Promise.all([getListingDetail(id), currentUser()]);
  if (!listing) notFound();
  const isOwner = user?.id === listing.owner_id;
  const hidden = HIDDEN_STATUSES.has(listing.status) || listing.owner_status !== "active";
  if (hidden && !isOwner && !can(user?.role, "listings.moderate")) notFound();

  const [profile, destinations, credits, onWishlist, request] = await Promise.all([
    publicProfile(listing.owner_id),
    reachableDestinations(listing),
    user ? availableCredits(user.id) : 0,
    user ? isOnWishlist(user.id, listing.book_id) : false,
    requestOptions(listing, user, user ? null : await chosenCountry()),
  ]);
  const postage = request.route && formatPostageRange(request.route);

  return (
    <div className="container page">
      <p className="small">
        <Link href="/explore">← Explore books</Link>
      </p>
      <div className="split">
        <div className="stack-lg">
          <div className="grid-2" style={{ alignItems: "start" }}>
            <ListingGallery listing={listing} />
            <ListingFacts listing={listing} destinations={destinations} />
          </div>
          <ConditionNotes notes={listing.condition_notes} />
          {profile && <OwnerCard profile={profile} />}
          {user && !isOwner && <ReportForm targetType="listing" targetId={listing.id} label="Report this listing" />}
        </div>

        <aside className="stack">
          <RequestBookPanel
            listing={listing}
            member={user}
            isOwner={isOwner}
            availableCredits={credits}
            request={request}
          />
          {user && !isOwner && <WishlistCard bookId={listing.book_id} onWishlist={onWishlist} />}
          {postage && (
            <p className="tiny muted">Typical sender postage on this route: {postage}, paid by the sender.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
