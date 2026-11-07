import { randomUUID } from "node:crypto";
import { pool, closePool, tx } from "../src/server/db";
import { hashPassword } from "../src/server/auth/password";
import { seedReferenceData } from "./reference-data";
import { placeholderPng } from "./png";
import { saveBuffer } from "../src/server/domain/files";
import { createListing, publishListing } from "../src/server/domain/listings";
import { adminAdjust } from "../src/server/domain/credits";
import { saveAddress } from "../src/server/domain/support";
import { requestBook } from "../src/server/domain/exchanges/request";
import { acceptRequest } from "../src/server/domain/exchanges/response";
import { markShipped } from "../src/server/domain/exchanges/shipping";
import { confirmReceipt } from "../src/server/domain/exchanges/completion";
import { leaveReview } from "../src/server/domain/exchanges/conversation";

const DEMO_PASSWORD = "yos-demo-password";

const USERS = [
  { email: "admin@yos.local", name: "YOS Admin", role: "admin", country: "GB" },
  { email: "moderator@yos.local", name: "YOS Support", role: "moderator", country: "GB" },
  {
    email: "maya@yos.local",
    name: "Maya",
    role: "member",
    country: "GB",
    scope: "international",
    bio: "Literary fiction, Victorian novels and anything with a lighthouse in it.",
  },
  {
    email: "alex@yos.local",
    name: "Alex",
    role: "member",
    country: "GB",
    scope: "domestic",
    bio: "Crime novels on the commute.",
  },
  {
    email: "sam@yos.local",
    name: "Sam",
    role: "member",
    country: "IE",
    scope: "international",
    bio: "Dublin reader, slowly working through the classics.",
  },
  {
    email: "jordan@yos.local",
    name: "Jordan",
    role: "member",
    country: "US",
    scope: "international",
    bio: "Sci-fi and big doorstop fantasy.",
  },
  {
    email: "priya@yos.local",
    name: "Priya",
    role: "member",
    country: "CA",
    scope: "international",
    bio: "Book club organiser in Toronto.",
  },
] as const;

const ADDRESSES: Record<string, { line1: string; city: string; region?: string; postal: string }> = {
  GB: { line1: "12 Example Street", city: "Manchester", postal: "M1 1AA" },
  IE: { line1: "4 Sample Road", city: "Dublin", region: "Dublin", postal: "D02 XY00" },
  US: { line1: "100 Demo Avenue", city: "Portland", region: "OR", postal: "97201" },
  CA: { line1: "55 Placeholder Blvd", city: "Toronto", region: "ON", postal: "M5V 2T6" },
};

const BOOKS: {
  owner: string;
  title: string;
  authors: string[];
  year?: number;
  format: string;
  condition: string;
  category: string;
  notes: string;
}[] = [
  {
    owner: "maya",
    title: "Middlemarch",
    authors: ["George Eliot"],
    year: 1871,
    format: "paperback",
    condition: "very_good",
    category: "literary-fiction",
    notes: "Light creasing on the spine, pages clean. Small name inscription on the first page.",
  },
  {
    owner: "maya",
    title: "Jane Eyre",
    authors: ["Charlotte Brontë"],
    year: 1847,
    format: "hardcover",
    condition: "like_new",
    category: "literary-fiction",
    notes: "Read once. Dust jacket intact, no marks.",
  },
  {
    owner: "maya",
    title: "To the Lighthouse",
    authors: ["Virginia Woolf"],
    year: 1927,
    format: "paperback",
    condition: "good",
    category: "literary-fiction",
    notes: "Some pencil underlining in chapters 1–3, otherwise clean. Cover corners slightly bumped.",
  },
  {
    owner: "maya",
    title: "Persuasion",
    authors: ["Jane Austen"],
    year: 1817,
    format: "paperback",
    condition: "very_good",
    category: "romance",
    notes: "Minor shelf wear on the cover edges. Pages bright and tight.",
  },
  {
    owner: "alex",
    title: "The Hound of the Baskervilles",
    authors: ["Arthur Conan Doyle"],
    year: 1902,
    format: "paperback",
    condition: "good",
    category: "mystery-thriller",
    notes: "Well loved: spine creased, a coffee ring on the back cover. All pages present.",
  },
  {
    owner: "alex",
    title: "The Moonstone",
    authors: ["Wilkie Collins"],
    year: 1868,
    format: "paperback",
    condition: "very_good",
    category: "mystery-thriller",
    notes: "Clean copy with a slightly faded spine.",
  },
  {
    owner: "sam",
    title: "Dubliners",
    authors: ["James Joyce"],
    year: 1914,
    format: "paperback",
    condition: "very_good",
    category: "literary-fiction",
    notes: "Tight binding, very light wear. No writing.",
  },
  {
    owner: "sam",
    title: "Dracula",
    authors: ["Bram Stoker"],
    year: 1897,
    format: "hardcover",
    condition: "good",
    category: "fantasy-scifi",
    notes: "Cloth hardcover, no jacket. Some foxing on the endpapers.",
  },
  {
    owner: "sam",
    title: "The Picture of Dorian Gray",
    authors: ["Oscar Wilde"],
    year: 1890,
    format: "paperback",
    condition: "acceptable",
    category: "literary-fiction",
    notes: "Heavily read. Cover creased and spine cracked in two places, but complete and readable.",
  },
  {
    owner: "jordan",
    title: "Frankenstein",
    authors: ["Mary Shelley"],
    year: 1818,
    format: "paperback",
    condition: "like_new",
    category: "fantasy-scifi",
    notes: "Bought for a class and barely opened.",
  },
  {
    owner: "jordan",
    title: "The Time Machine",
    authors: ["H. G. Wells"],
    year: 1895,
    format: "paperback",
    condition: "very_good",
    category: "fantasy-scifi",
    notes: "Small crease on the front cover.",
  },
  {
    owner: "jordan",
    title: "Moby-Dick",
    authors: ["Herman Melville"],
    year: 1851,
    format: "hardcover",
    condition: "good",
    category: "literary-fiction",
    notes: "Library discard with stamps inside the cover; otherwise sound.",
  },
  {
    owner: "priya",
    title: "Anne of Green Gables",
    authors: ["L. M. Montgomery"],
    year: 1908,
    format: "childrens",
    condition: "very_good",
    category: "childrens",
    notes: "Lovely clean copy, slight yellowing of pages.",
  },
  {
    owner: "priya",
    title: "Little Women",
    authors: ["Louisa May Alcott"],
    year: 1868,
    format: "paperback",
    condition: "good",
    category: "historical-fiction",
    notes: "Book club copy, a few highlighted passages, disclosed in photos.",
  },
  {
    owner: "priya",
    title: "The Secret Garden",
    authors: ["Frances Hodgson Burnett"],
    year: 1911,
    format: "picture_book",
    condition: "like_new",
    category: "childrens",
    notes: "Illustrated edition in excellent condition.",
  },
];

async function main() {
  const reset = process.argv.includes("--reference-only") ? false : true;
  const db = pool();
  await seedReferenceData(db);
  console.log("reference data seeded (countries, routes, categories)");
  if (!reset) return;

  const existing = await db.query("SELECT 1 FROM users WHERE email = 'admin@yos.local'");
  if (existing.rowCount) {
    console.log("demo data already present, run `npm run db:reset` to start fresh");
    return;
  }

  // Example indicative postage on a few routes so the sender-facing estimate can be seen.
  // Replace with verified carrier rates before launch.
  await db.query(
    `UPDATE shipping_routes SET postage_estimate_min = 2.70, postage_estimate_max = 4.50, postage_currency = 'GBP' WHERE origin_country = 'GB' AND destination_country = 'GB'`,
  );
  await db.query(
    `UPDATE shipping_routes SET postage_estimate_min = 9.00, postage_estimate_max = 14.00, postage_currency = 'GBP' WHERE origin_country = 'GB' AND destination_country = 'IE'`,
  );
  await db.query(
    `UPDATE shipping_routes SET postage_estimate_min = 4.13, postage_estimate_max = 6.50, postage_currency = 'USD' WHERE origin_country = 'US' AND destination_country = 'US'`,
  );

  const hash = await hashPassword(DEMO_PASSWORD);
  const ids: Record<string, string> = {};
  for (const u of USERS) {
    const r = await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, display_name, role, country_code, email_verified_at, terms_version, terms_accepted_at,
         age_confirmed_at, ship_scope, bio, created_at)
       VALUES ($1, $2, $3, $4, $5, now(), 'seed', now(), now(), $6, $7, now() - interval '60 days') RETURNING id`,
      [u.email, hash, u.name, u.role, u.country, "scope" in u ? u.scope : "domestic", "bio" in u ? u.bio : null],
    );
    ids[u.email.split("@")[0]] = r.rows[0].id;
    await db.query("INSERT INTO credit_accounts (user_id) VALUES ($1)", [r.rows[0].id]);
    const a = ADDRESSES[u.country];
    await saveAddress(r.rows[0].id, {
      label: "Home",
      recipientName: u.name,
      line1: a.line1,
      line2: "",
      city: a.city,
      region: a.region ?? "",
      postalCode: a.postal,
      country: u.country,
      phone: "",
      isDefault: true,
    });
  }

  const cats = Object.fromEntries(
    (await db.query<{ slug: string; id: number }>("SELECT slug, id FROM categories")).rows.map((r) => [r.slug, r.id]),
  );
  const listingIds: Record<string, string> = {};
  let hue = 0;
  for (const b of BOOKS) {
    const ownerId = ids[b.owner];
    const owner = USERS.find((u) => u.email.startsWith(b.owner + "@"))!;
    const listingId = await createListing(
      ownerId,
      { input: { title: b.title, authors: b.authors, publicationYear: b.year, language: "en" } },
      {
        format: b.format,
        language: "en",
        condition: b.condition,
        conditionNotes: b.notes,
        editionNotes: "",
        categoryId: cats[b.category],
        weightGrams: b.format === "hardcover" ? 650 : 320,
        shipScope: "scope" in owner ? owner.scope : "domestic",
        shipCountries: [],
      },
    );
    await tx(async (c) => {
      const fileId = await saveBuffer(c, placeholderPng(360, 480, (hue += 47) % 360), "listing_photo", ownerId);
      await c.query("INSERT INTO listing_photos (listing_id, file_id, position) VALUES ($1, $2, 0)", [
        listingId,
        fileId,
      ]);
    });
    await publishListing(ownerId, listingId, { confirmPossession: true });
    listingIds[b.title] = listingId;
  }

  // Demo balances so requests can be tried immediately. Real members earn credits by sending books.
  for (const who of ["alex", "maya", "jordan", "priya", "sam"]) {
    await adminAdjust({
      adminId: ids.admin,
      userId: ids[who],
      amount: who === "alex" ? 3 : 1,
      reason: "Demo data: starting balance for testing",
      idempotencyKey: `seed-${who}`,
    });
  }

  const addr = async (who: string) =>
    (await db.query<{ id: string }>("SELECT id FROM addresses WHERE user_id = $1", [ids[who]])).rows[0].id;

  // Alex requests from Maya, Maya ships, Alex confirms, and Maya earns a credit.
  const ex1 = await requestBook({
    requesterId: ids.alex,
    listingId: listingIds["Middlemarch"],
    addressId: await addr("alex"),
    requestKey: randomUUID(),
  });
  await acceptRequest(ids.maya, ex1);
  await markShipped(ids.maya, ex1, {
    carrier: "Royal Mail Tracked 48",
    trackingNumber: "RM482913570GB",
    dispatchDate: new Date().toISOString().slice(0, 10),
  });
  await confirmReceipt(ids.alex, ex1);
  await leaveReview(ids.alex, ex1, {
    rating: 5,
    tags: ["well_packed", "fast_dispatch"],
    comment: "Arrived quickly and exactly as described. Thank you!",
  });
  await leaveReview(ids.maya, ex1, { rating: 5, tags: ["great_communication"], comment: null });

  // 2) Maya spends that credit on Sam's book across the GB ← IE route: awaiting Sam's response.
  await requestBook({
    requesterId: ids.maya,
    listingId: listingIds["Dubliners"],
    addressId: await addr("maya"),
    requestKey: randomUUID(),
  });

  // 3) Jordan (US) requests Priya's book (CA): accepted, awaiting dispatch.
  const ex3 = await requestBook({
    requesterId: ids.jordan,
    listingId: listingIds["Anne of Green Gables"],
    addressId: await addr("jordan"),
    requestKey: randomUUID(),
  });
  await acceptRequest(ids.priya, ex3);

  // 4) Alex requests another of Maya's books: shipped, in transit.
  const ex4 = await requestBook({
    requesterId: ids.alex,
    listingId: listingIds["Persuasion"],
    addressId: await addr("alex"),
    requestKey: randomUUID(),
  });
  await acceptRequest(ids.maya, ex4);
  await markShipped(ids.maya, ex4, {
    carrier: "Evri",
    trackingNumber: "H01HYA0012345678",
    dispatchDate: new Date().toISOString().slice(0, 10),
  });

  await db.query("INSERT INTO announcements (message, level, created_by) VALUES ($1, 'info', $2)", [
    "Welcome to the YOS closed beta! Exchanges are open in the UK, Ireland, the US and Canada, with Australia and New Zealand in limited preview.",
    ids.admin,
  ]);

  console.log(
    `demo data seeded. Sign in with any of:\n${USERS.map((u) => `  ${u.email}`).join("\n")}\npassword: ${DEMO_PASSWORD}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
