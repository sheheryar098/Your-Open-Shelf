import Link from "next/link";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { addToWishlistAction } from "../api/actions";

export function WishlistCard({ bookId, onWishlist }: { bookId: string; onWishlist: boolean }) {
  return (
    <div className="card card-flat">
      {onWishlist ? (
        <p className="small mb-0">
          This book is on your <Link href="/wishlist">wish list</Link>.
        </p>
      ) : (
        <ActionForm action={addToWishlistAction.bind(null, bookId)} className="stack-sm">
          <p className="small mb-0">
            Want this title but not this copy? We&apos;ll tell you when another copy that can reach you is listed.
          </p>
          <SubmitButton className="btn btn-block">Add to wish list</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
