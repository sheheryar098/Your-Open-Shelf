import { tx, isUniqueViolation } from "@/server/db";
import { DomainError, ForbiddenError } from "@/server/errors";
import { addDays, now } from "@/server/clock";
import { notify } from "../notifications";
import { lockExchange } from "./core";

export async function postMessage(userId: string, exchangeId: string, body: string) {
  const text = body?.trim();
  if (!text) throw new DomainError("Write a message.");
  if (text.length > 2000) throw new DomainError("Messages can be up to 2000 characters.");
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.requester_id !== userId && ex.sender_id !== userId) throw new ForbiddenError();
    if (ex.closed_at && ex.closed_at < addDays(now(), -30))
      throw new DomainError("Messaging is closed for this exchange.");
    await c.query("INSERT INTO messages (exchange_id, sender_id, body, created_at) VALUES ($1, $2, $3, $4)", [
      ex.id,
      userId,
      text,
      now(),
    ]);
    const other = userId === ex.requester_id ? ex.sender_id : ex.requester_id;
    await notify(c, other, {
      type: "message",
      title: "New message about an exchange",
      body: text.slice(0, 140),
      link: `/exchanges/${ex.id}#messages`,
      email: false,
    });
  });
}

export async function leaveReview(
  userId: string,
  exchangeId: string,
  input: { rating: number; tags: string[]; comment?: string | null },
) {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
    throw new DomainError("Choose a rating from 1 to 5.");
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.requester_id !== userId && ex.sender_id !== userId) throw new ForbiddenError();
    // Feedback only makes sense once the book has actually changed hands.
    if (ex.status !== "completed") throw new DomainError("You can leave feedback once the exchange is completed.");
    const reviewee = userId === ex.requester_id ? ex.sender_id : ex.requester_id;
    try {
      await c.query(
        `INSERT INTO reviews (exchange_id, reviewer_id, reviewee_id, rating, tags, comment, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          ex.id,
          userId,
          reviewee,
          input.rating,
          input.tags.slice(0, 7),
          input.comment?.trim().slice(0, 1000) || null,
          now(),
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new DomainError("You've already left feedback for this exchange.");
      throw err;
    }
  });
}
