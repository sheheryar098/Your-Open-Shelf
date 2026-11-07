import type { PoolClient } from "pg";
import { query, queryOne, type Db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { looksLikeIsbn, normalizeIsbn, toIsbn13 } from "@/lib/isbn";

export interface Book {
  id: string;
  isbn13: string | null;
  isbn10: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  publication_year: number | null;
  language: string | null;
  edition: string | null;
  description: string | null;
  source: string;
}

export async function getBook(id: string, db?: Db) {
  return queryOne<Book>("SELECT * FROM books WHERE id = $1", [id], db);
}

/** Catalog search used by the "List a Book" flow: ISBN exact match, else title/author text search. */
export async function searchCatalog(q: string, limit = 12): Promise<Book[]> {
  const term = q.trim();
  if (!term) return [];
  if (looksLikeIsbn(term)) {
    const isbn13 = toIsbn13(term);
    const n = normalizeIsbn(term);
    return query<Book>("SELECT * FROM books WHERE isbn13 = $1 OR isbn10 = $2 LIMIT $3", [isbn13, n, limit]);
  }
  return query<Book>(
    `SELECT * FROM books
     WHERE search_vector @@ websearch_to_tsquery('simple', $1) OR lower(title) LIKE '%' || lower($1) || '%'
     ORDER BY ts_rank(search_vector, websearch_to_tsquery('simple', $1)) DESC, title
     LIMIT $2`,
    [term, limit],
  );
}

export interface BookInput {
  isbn?: string | null;
  title: string;
  subtitle?: string | null;
  authors: string[];
  publisher?: string | null;
  publicationYear?: number | null;
  language?: string | null;
  edition?: string | null;
}

/**
 * Finds the shared catalog record for an ISBN or creates one. Catalog metadata is kept
 * separate from each member's copy (§7.5) so duplicate editions converge on one record.
 */
export async function findOrCreateBook(c: PoolClient, input: BookInput, source: "member" | "lookup" | "admin" = "member"): Promise<Book> {
  const title = input.title.trim();
  if (!title) throw new DomainError("Enter the book's title.");
  const authors = input.authors.map((a) => a.trim()).filter(Boolean).slice(0, 10);
  if (authors.length === 0) throw new DomainError("Enter at least one author or editor.");
  let isbn13: string | null = null;
  let isbn10: string | null = null;
  if (input.isbn && input.isbn.trim()) {
    isbn13 = toIsbn13(input.isbn);
    if (!isbn13) throw new DomainError("That ISBN doesn't look valid. Check the digits, or leave it blank.");
    const n = normalizeIsbn(input.isbn);
    if (n.length === 10) isbn10 = n;
    const existing = (await c.query<Book>("SELECT * FROM books WHERE isbn13 = $1", [isbn13])).rows[0];
    if (existing) return existing;
  } else {
    const existing = (
      await c.query<Book>(
        "SELECT * FROM books WHERE isbn13 IS NULL AND lower(title) = lower($1) AND authors = $2 AND coalesce(edition, '') = coalesce($3, '') LIMIT 1",
        [title, authors, input.edition?.trim() || null],
      )
    ).rows[0];
    if (existing) return existing;
  }
  const year = input.publicationYear && input.publicationYear > 0 && input.publicationYear < 3000 ? input.publicationYear : null;
  const res = await c.query<Book>(
    `INSERT INTO books (isbn13, isbn10, title, subtitle, authors, publisher, publication_year, language, edition, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (isbn13) DO UPDATE SET updated_at = books.updated_at
     RETURNING *`,
    [isbn13, isbn10, title, input.subtitle?.trim() || null, authors, input.publisher?.trim() || null, year,
      input.language || null, input.edition?.trim() || null, source],
  );
  return res.rows[0];
}

export async function updateBookMetadata(c: PoolClient, id: string, patch: Partial<BookInput>) {
  const book = (await c.query<Book>("SELECT * FROM books WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!book) throw new DomainError("Catalog record not found.");
  const isbn13 = patch.isbn !== undefined ? (patch.isbn ? toIsbn13(patch.isbn) : null) : book.isbn13;
  if (patch.isbn && !isbn13) throw new DomainError("Invalid ISBN.");
  await c.query(
    `UPDATE books SET isbn13 = $2, title = $3, subtitle = $4, authors = $5, publisher = $6, publication_year = $7,
       edition = $8, source = 'admin', updated_at = now() WHERE id = $1`,
    [id, isbn13, patch.title ?? book.title, patch.subtitle ?? book.subtitle, patch.authors ?? book.authors,
      patch.publisher ?? book.publisher, patch.publicationYear ?? book.publication_year, patch.edition ?? book.edition],
  );
}

/**
 * Optional ISBN metadata lookup (metadata only — no cover images, which need licensing, §20.4).
 * Enabled with CATALOG_LOOKUP=openlibrary.
 */
export async function lookupIsbn(raw: string): Promise<BookInput | null> {
  if (process.env.CATALOG_LOOKUP !== "openlibrary") return null;
  const isbn = toIsbn13(raw);
  if (!isbn) return null;
  try {
    const ctrl = AbortSignal.timeout(4000);
    const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, {
      signal: ctrl,
      headers: { "User-Agent": "YOS-YourOpenShelf/0.1 (catalog lookup)" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, {
      title?: string; subtitle?: string; authors?: { name: string }[]; publishers?: { name: string }[]; publish_date?: string;
    }>;
    const d = data[`ISBN:${isbn}`];
    if (!d?.title) return null;
    const year = d.publish_date?.match(/\d{4}/)?.[0];
    return {
      isbn,
      title: d.title,
      subtitle: d.subtitle ?? null,
      authors: (d.authors ?? []).map((a) => a.name),
      publisher: d.publishers?.[0]?.name ?? null,
      publicationYear: year ? Number(year) : null,
    };
  } catch {
    return null;
  }
}
