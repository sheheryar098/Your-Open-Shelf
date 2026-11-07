"use server";

import { redirect } from "next/navigation";
import { bool, files, run, str, type ActionState } from "@/shared/api/action";
import { DomainError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { actionUser } from "@/shared/api/session";
import {
  addListingPhotos,
  addToWishlist,
  copySchema,
  createListing,
  publishListing,
  removeFromWishlist,
  removeListingPhoto,
  setOwnListingStatus,
  updateListing,
} from "@/server/domain/listings";

function parseCopy(fd: FormData) {
  const parsed = copySchema.safeParse({
    format: str(fd, "format"),
    language: str(fd, "language"),
    condition: str(fd, "condition"),
    conditionNotes: str(fd, "conditionNotes"),
    editionNotes: str(fd, "editionNotes"),
    categoryId: str(fd, "categoryId") || null,
    weightGrams: str(fd, "weightGrams") || null,
    shipScope: str(fd, "shipScope") || "domestic",
    shipCountries: fd.getAll("shipCountries").map(String).filter(Boolean),
  });
  if (!parsed.success) throw new DomainError(parsed.error.issues[0].message);
  return parsed.data;
}

export async function createListingAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    enforceRateLimit(
      `list:${u.id}`,
      30,
      60 * 60_000,
      "You've created a lot of listings in a short time. Please try again later.",
    );
    const copy = parseCopy(fd);
    const bookId = str(fd, "bookId") || null;
    const id = await createListing(
      u.id,
      bookId
        ? { bookId }
        : {
            input: {
              isbn: str(fd, "isbn") || null,
              title: str(fd, "title"),
              subtitle: str(fd, "subtitle") || null,
              authors: str(fd, "authors").split(/[,;]/),
              publisher: str(fd, "publisher") || null,
              publicationYear: Number(str(fd, "year")) || null,
              language: copy.language,
              edition: str(fd, "edition") || null,
            },
          },
      copy,
    );
    const photos = files(fd, "photos");
    if (photos.length) await addListingPhotos(u.id, id, photos);
    redirect(`/my/books/${id}?created=1`);
  });
}

export async function updateListingAction(id: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    await updateListing(u.id, id, parseCopy(fd));
    return "Listing details saved.";
  });
}

export async function addPhotosAction(id: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    await addListingPhotos(u.id, id, files(fd, "photos"));
    return "Photos added.";
  });
}

export async function removePhotoAction(listingId: string, photoId: string, _: ActionState) {
  return run(async () => {
    const u = await actionUser();
    await removeListingPhoto(u.id, listingId, photoId);
    return "Photo removed.";
  });
}

export async function publishListingAction(id: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    await publishListing(u.id, id, {
      confirmPossession: bool(fd, "confirmPossession"),
      confirmAnotherCopy: bool(fd, "confirmAnotherCopy"),
    });
    return "Your book is now live on the shelf.";
  });
}

export async function listingStatusAction(
  id: string,
  action: "pause" | "resume" | "remove" | "reconfirm",
  _: ActionState,
) {
  return run(async () => {
    const u = await actionUser();
    await setOwnListingStatus(u.id, id, action);
    if (action === "remove") redirect("/my/books?removed=1");
    return {
      pause: "Listing paused.",
      resume: "Listing is active again.",
      reconfirm: "Thanks, availability confirmed.",
      remove: "",
    }[action];
  });
}

export async function addToWishlistAction(bookId: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    await addToWishlist(u.id, bookId, { format: str(fd, "format") || null, language: str(fd, "language") || null });
    return "Added to your wish list. We'll let you know when a copy that can reach you is listed.";
  });
}

export async function removeFromWishlistAction(itemId: string, _: ActionState) {
  return run(async () => {
    const u = await actionUser();
    await removeFromWishlist(u.id, itemId);
    return "Removed from your wish list.";
  });
}
