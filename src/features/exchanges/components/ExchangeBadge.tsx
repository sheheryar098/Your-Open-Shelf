import { EXCHANGE_STATUS_LABEL } from "@/shared/lib/vocab";
import { Badge, type Tone } from "@/shared/ui/primitives";

const TONE: Record<string, Tone | undefined> = {
  requested: "warn",
  accepted: "info",
  shipped: "info",
  delivered: "accent",
  completed: "ok",
  disputed: "danger",
};

export function ExchangeBadge({ status }: { status: string }) {
  return <Badge tone={TONE[status]}>{EXCHANGE_STATUS_LABEL[status] ?? status}</Badge>;
}
