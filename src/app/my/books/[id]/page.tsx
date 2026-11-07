import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getListingDetail } from "@/domain/listings";
import { query } from "@/lib/db";
import { authorsText, fmtDate } from "@/lib/format";
import { policy } from "@/lib/config";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { CopyFields } from "@/components/CopyFields";
import { ExchangeBadge, ListingBadge, Photo } from "@/components/ui";
import {
  addPhotosAction, listingStatusAction, publishListingAction, removePhotoAction, updateListingAction,
} from "@/app/actions/listings";

export const metadata = { title: "Manage listing" };

export default async function ManageListing({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const u = await requireUser("/my/books");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const l = await getListingDetail(id);
  if (!l || l.owner_id !== u.id) notFound();
  const exchanges = await query<{ id: string; status: string; requested_at: Date }>(
    "SELECT id, status, requested_at FROM exchanges WHERE listing_id = $1 ORDER BY requested_at DESC",
    [id],
  );
  const editable = ["draft", "active", "paused", "unavailable"].includes(l.status);
  const publishable = ["draft", "paused", "unavailable"].includes(l.status);

  return (
    <div className="container page stack-lg">
      <p className="small"><Link href="/my/books">← My books</Link></p>
      <div className="row-between">
        <div>
          <h1 className="mb-0">{l.title}</h1>
          <div className="muted">{authorsText(l.authors)}</div>
        </div>
        <div className="row"><ListingBadge status={l.status} />{l.status !== "draft" && <Link href={`/books/${l.id}`} className="btn btn-sm">View public page</Link>}</div>
      </div>
      {sp.created && <div className="alert alert-ok">Draft saved. Check the details, make sure you have at least one photo, then publish.</div>}
      {l.status_reason && <div className="alert alert-info">{l.status_reason}</div>}

      {publishable && (
        <section className="card">
          <h2>{l.status === "draft" ? "Publish this listing" : "Make this listing active again"}</h2>
          <ActionForm action={publishListingAction.bind(null, l.id)}>
            <label className="check">
              <input type="checkbox" name="confirmPossession" required />
              <span>I confirm this book is in my possession, matches the description and photos, and I&apos;m ready to ship it within {policy.dispatchBusinessDays} business days of accepting a request.</span>
            </label>
            <label className="check small">
              <input type="checkbox" name="confirmAnotherCopy" />
              <span>I have another listing for this title and this is a separate physical copy.</span>
            </label>
            <SubmitButton>Publish</SubmitButton>
          </ActionForm>
        </section>
      )}

      {l.status === "active" && (
        <section className="card">
          <div className="row">
            <ActionForm action={listingStatusAction.bind(null, l.id, "reconfirm")} className="inline-form">
              <SubmitButton className="btn btn-sm">Confirm still available</SubmitButton>
            </ActionForm>
            <ActionForm action={listingStatusAction.bind(null, l.id, "pause")} className="inline-form">
              <SubmitButton className="btn btn-sm">Pause listing</SubmitButton>
            </ActionForm>
            <span className="small muted">Last confirmed available {fmtDate(l.confirmed_available_at)}. Listings are paused automatically after {policy.staleListingDays} days without confirmation.</span>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Photos</h2>
        {l.photos.length === 0 && <p className="small">No photos yet. Add at least one photo of the actual copy.</p>}
        <div className="gallery">
          {l.photos.map((p) => (
            <div key={p.id} style={{ position: "relative" }}>
              <Photo fileId={p.file_id} alt="Listing photo" />
              {!["exchanged", "removed"].includes(l.status) && (
                <div style={{ position: "absolute", bottom: 6, right: 6 }}>
                  <ActionForm action={removePhotoAction.bind(null, l.id, p.id)} className="inline-form" confirm="Remove this photo?">
                    <SubmitButton className="btn btn-sm">Remove</SubmitButton>
                  </ActionForm>
                </div>
              )}
            </div>
          ))}
        </div>
        {l.photos.length < policy.maxPhotosPerListing && !["exchanged", "removed"].includes(l.status) && (
          <ActionForm action={addPhotosAction.bind(null, l.id)} encType="multipart/form-data" className="row" resetOnSuccess>
            <input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple required aria-label="Add photos" />
            <SubmitButton className="btn btn-sm" pendingText="Uploading…">Upload</SubmitButton>
          </ActionForm>
        )}
      </section>

      {editable ? (
        <section className="card">
          <h2>Copy details</h2>
          <ActionForm action={updateListingAction.bind(null, l.id)}>
            <CopyFields d={l} origin={l.origin_country} />
            <SubmitButton>Save changes</SubmitButton>
          </ActionForm>
        </section>
      ) : (
        <div className="alert alert-info">This listing can&apos;t be edited while it&apos;s {l.status.replace("_", " ")}.</div>
      )}

      {exchanges.length > 0 && (
        <section className="card">
          <h2>Request activity</h2>
          {exchanges.map((e) => (
            <div key={e.id} className="list-item">
              <div className="body"><Link href={`/exchanges/${e.id}`}>Request on {fmtDate(e.requested_at)}</Link></div>
              <ExchangeBadge status={e.status} />
            </div>
          ))}
        </section>
      )}

      {!["reserved", "exchanged", "removed", "under_review"].includes(l.status) && (
        <ActionForm action={listingStatusAction.bind(null, l.id, "remove")} confirm="Remove this listing? This can't be undone." className="inline-form">
          <SubmitButton className="btn btn-danger btn-sm">Remove listing</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
