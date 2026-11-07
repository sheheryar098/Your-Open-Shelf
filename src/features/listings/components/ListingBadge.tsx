import { LISTING_STATUS_LABEL } from "@/shared/lib/vocab";
import { Badge, type Tone } from "@/shared/ui/primitives";

const TONE: Record<string, Tone | undefined> = {
  active: "ok", reserved: "warn", exchanged: "accent", removed: "danger", under_review: "danger",
};

export function ListingBadge({ status }: { status: string }) {
  return <Badge tone={TONE[status]}>{LISTING_STATUS_LABEL[status] ?? status}</Badge>;
}
