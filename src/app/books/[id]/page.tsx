import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { getListingDetail } from "@/domain/listings";
import { checkEligibility, reachableDestinations } from "@/domain/routes";
import { getWallet } from "@/domain/credits";
import { addressesFor, publicProfile } from "@/domain/support";
import { currentUser } from "@/lib/auth/session";
import { chosenCountry } from "@/lib/geo";
import { countryName, formatMoney } from "@/lib/countries";
import { CONDITIONS, FORMATS, LANGUAGES, label } from "@/lib/vocab";
import { authorsText, fmtDate, plural } from "@/lib/format";
import { policy } from "@/lib/config";
import { queryOne } from "@/lib/db";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Cover, ListingBadge, Photo, Stars } from "@/components/ui";
import { ReportForm } from "@/components/ReportForm";
import { requestBookAction } from "@/app/actions/exchanges";
import { addToWishlistAction } from "@/app/actions/listings";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = /^[0-9a-f-]{36}$/i.test(id) ? await getListingDetail(id) : null;
  return { title: l ? `${l.title} by ${authorsText(l.authors)}` : "Book" };
}

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const l = await getListingDetail(id);
  const user = await currentUser();
  const isOwner = user?.id === l?.owner_id;
  const isStaff = user && (user.role === "admin" || user.role === "moderator");
  if (!l || ((["draft", "removed", "under_review"].includes(l.status) || l.owner_status !== "active") && !isOwner && !isStaff)) notFound();

  const [profile, destinations, wallet, addresses, wished] = await Promise.all([
    publicProfile(l.owner_id),
    reachableDestinations(l),
    user ? getWallet(user.id) : null,
    user ? addressesFor(user.id) : [],
    user ? queryOne("SELECT 1 FROM wishlist_items WHERE user_id = $1 AND book_id = $2", [user.id, l.book_id]) : null,
  ]);
  const viewerCountry = user?.country_code ?? (await chosenCountry());
  const addressChecks = await Promise.all(addresses.map(async (a) => ({ a, elig: await checkEligibility(l, a.country_code) })));
  const eligibleAddresses = addressChecks.filter((x) => x.elig.ok);
  const viewerElig = viewerCountry ? await checkEligibility(l, viewerCountry) : null;
  const route = eligibleAddresses[0]?.elig.ok ? eligibleAddresses[0].elig.route : viewerElig?.ok ? viewerElig.route : null;

  return (
    <div className="container page">
      <p className="small"><Link href="/explore">← Explore books</Link></p>
      <div className="split">
        <div className="stack-lg">
          <div className="grid-2" style={{ alignItems: "start" }}>
            <div className="stack-sm">
              {l.photos[0] ? (
                <div className="cover-photo"><Photo fileId={l.photos[0].file_id} alt={`Photo of this copy of ${l.title}`} /></div>
              ) : (
                <Cover title={l.title} authors={l.authors} />
              )}
              <p className="tiny muted">Photos show the member&apos;s actual copy.</p>
              {l.photos.length > 1 && (
                <div className="gallery">
                  {l.photos.slice(1).map((p, i) => (
                    <a key={p.id} href={`/files/${p.file_id}`} target="_blank" rel="noreferrer">
                      <Photo fileId={p.file_id} alt={`Additional photo ${i + 2} of this copy`} />
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="row"><ListingBadge status={l.status} />{l.category_name && <Badge>{l.category_name}</Badge>}</div>
              <h1 style={{ marginTop: 10 }}>{l.title}</h1>
              {l.subtitle && <p className="lede">{l.subtitle}</p>}
              <p>by {authorsText(l.authors)}</p>
              <dl className="dl">
                <dt>Format</dt><dd>{label(FORMATS, l.format)}</dd>
                <dt>Language</dt><dd>{LANGUAGES[l.language] ?? l.language}</dd>
                <dt>Condition</dt><dd><strong>{label(CONDITIONS, l.condition)}</strong> — <span className="muted">{CONDITIONS[l.condition]?.guidance}</span></dd>
                {(l.edition || l.edition_notes) && <><dt>Edition</dt><dd>{[l.edition, l.edition_notes].filter(Boolean).join(" · ")}</dd></>}
                {l.isbn13 && <><dt>ISBN</dt><dd className="mono">{l.isbn13}</dd></>}
                {l.publisher && <><dt>Publisher</dt><dd>{l.publisher}{l.publication_year ? `, ${l.publication_year}` : ""}</dd></>}
                {!l.publisher && l.publication_year && <><dt>First published</dt><dd>{l.publication_year}</dd></>}
                <dt>Ships from</dt><dd>{countryName(l.origin_country)}</dd>
                <dt>Ships to</dt>
                <dd>{destinations.length ? destinations.map((d) => countryName(d)).join(", ") : <span className="muted">No supported routes right now</span>}</dd>
                <dt>Listed</dt><dd>{fmtDate(l.published_at ?? l.created_at)}</dd>
                <dt>Cost</dt><dd><strong>1 YOS credit</strong> <span className="muted small">· sender pays postage</span></dd>
              </dl>
            </div>
          </div>

          <section className="card">
            <h2>Condition notes from the member</h2>
            <p style={{ whiteSpace: "pre-wrap" }}>{l.condition_notes}</p>
            <p className="small muted mb-0">
              Condition is described by the member and isn&apos;t inspected by YOS. If a book arrives materially different, you can open a dispute.{" "}
              <Link href="/condition-guide">Condition guide</Link>
            </p>
          </section>

          {profile && (
            <section className="card">
              <div className="row-between">
                <div>
                  <h3 className="mb-0"><Link href={`/members/${l.owner_id}`}>{profile.user.display_name}</Link></h3>
                  <div className="small muted">
                    {profile.user.country_code && countryName(profile.user.country_code)} · Member since {fmtDate(profile.user.created_at)}
                  </div>
                </div>
                <div className="right small">
                  {profile.avgRating ? <><Stars value={profile.avgRating} /> ({profile.reviewCount})</> : <span className="muted">No ratings yet</span>}
                  <div className="muted">{plural(profile.completed, "completed exchange")}</div>
                </div>
              </div>
            </section>
          )}
          {user && !isOwner && <ReportForm targetType="listing" targetId={l.id} label="Report this listing" />}
        </div>

        <aside className="stack">
          <div className="card">
            {isOwner ? (
              <>
                <h3>This is your listing</h3>
                <p className="small">Members will see the request button here.</p>
                <Link href={`/my/books/${l.id}`} className="btn btn-block">Manage listing</Link>
              </>
            ) : l.status !== "active" ? (
              <>
                <h3>{l.status === "reserved" ? "Reserved" : "Not available"}</h3>
                <p className="small">{l.status === "reserved" ? "Another member has requested this copy." : "This copy can't be requested right now."}</p>
              </>
            ) : !user ? (
              <>
                <h3>Request this book</h3>
                <p className="small">Join YOS or sign in to request books with credits.</p>
                {viewerElig && !viewerElig.ok && <div className="alert alert-warn small" style={{ marginBottom: 12 }}>{viewerElig.reason}</div>}
                <div className="stack-sm">
                  <Link href={`/signin?next=/books/${l.id}`} className="btn btn-primary btn-block">Sign in to request</Link>
                  <Link href="/signup" className="btn btn-block">Join YOS</Link>
                </div>
              </>
            ) : (
              <>
                <h3>Request this book</h3>
                <div className="row-between small" style={{ marginBottom: 12 }}>
                  <span>Your available credits</span>
                  <strong>{wallet?.available ?? 0}</strong>
                </div>
                {!user.email_verified_at ? (
                  <div className="alert alert-warn small">Verify your email to request books. <Link href="/verify-email">Resend link</Link></div>
                ) : !user.can_request ? (
                  <div className="alert alert-warn small">Requesting is restricted on your account. <Link href="/support/new">Contact support</Link></div>
                ) : (wallet?.available ?? 0) < l.credit_cost ? (
                  <div className="alert alert-info small">
                    You need 1 available credit. Earn one by <Link href="/my/books/new">listing a book</Link> and sending it to another member.
                  </div>
                ) : addresses.length === 0 ? (
                  <div className="alert alert-info small">
                    Add a delivery address first. <Link href={`/settings/addresses?back=/books/${l.id}`}>Add address</Link>
                  </div>
                ) : eligibleAddresses.length === 0 ? (
                  <div className="alert alert-warn small">{addressChecks[0].elig.ok ? "" : addressChecks[0].elig.reason}</div>
                ) : (
                  <ActionForm action={requestBookAction.bind(null, l.id)}>
                    <input type="hidden" name="requestKey" value={randomUUID()} />
                    <div className="field">
                      <label htmlFor="addressId">Deliver to</label>
                      <select id="addressId" name="addressId" defaultValue={eligibleAddresses.find((x) => x.a.is_default)?.a.id ?? eligibleAddresses[0].a.id}>
                        {addressChecks.map(({ a, elig }) => (
                          <option key={a.id} value={a.id} disabled={!elig.ok}>
                            {a.label ? `${a.label}: ` : ""}{a.city}, {countryName(a.country_code)}{elig.ok ? "" : " — not supported"}
                          </option>
                        ))}
                      </select>
                      <span className="help">Shared with the sender only after they accept. <Link href={`/settings/addresses?back=/books/${l.id}`}>Manage addresses</Link></span>
                    </div>
                    {route && (
                      <div className="small stack-sm">
                        <div><strong>Route:</strong> {countryName(route.origin_country)} → {countryName(route.destination_country)}</div>
                        {route.min_delivery_days != null && <div>Typical delivery: {route.min_delivery_days}–{route.max_delivery_days} days after dispatch (not guaranteed).</div>}
                        <div>Tracking: {route.tracking_required ? "required on this route" : "recommended"}</div>
                        {route.customs_notice && <div className="callout callout-warm">{route.customs_notice}</div>}
                      </div>
                    )}
                    <div className="callout small">
                      <p>1 credit will be <strong>reserved</strong> now. It&apos;s spent only when the exchange completes, and returned automatically if the sender declines or doesn&apos;t respond within {policy.senderResponseDays} days.</p>
                    </div>
                    <label className="check small">
                      <input type="checkbox" required name="ack" />
                      <span>I&apos;ve reviewed the condition, photos and route details, and agree to the <Link href="/legal/disputes" target="_blank">exchange rules</Link>.</span>
                    </label>
                    <SubmitButton className="btn btn-primary btn-block" pendingText="Requesting…">Request for 1 credit</SubmitButton>
                  </ActionForm>
                )}
              </>
            )}
          </div>
          {user && !isOwner && (
            <div className="card card-flat">
              {wished ? (
                <p className="small mb-0">This book is on your <Link href="/wishlist">wish list</Link>.</p>
              ) : (
                <ActionForm action={addToWishlistAction.bind(null, l.book_id)} className="stack-sm">
                  <p className="small mb-0">Want this title, but not this copy? Get an alert when another copy that can reach you is listed.</p>
                  <SubmitButton className="btn btn-block">Add to wish list</SubmitButton>
                </ActionForm>
              )}
            </div>
          )}
          {route?.postage_estimate_min && (
            <p className="tiny muted">
              Indicative sender postage on this route: {formatMoney(route.postage_estimate_min, route.postage_currency)}–{formatMoney(route.postage_estimate_max, route.postage_currency)} (paid by the sender).
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
