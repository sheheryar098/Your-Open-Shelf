import { requireUser } from "@/shared/api/session";
import { exchangesFor } from "@/server/domain/exchanges/queries";
import { runJobsIfDue } from "@/server/jobs/runner";
import { ExchangeList } from "@/features/exchanges/components/ExchangeList";
import { Tabs } from "@/shared/ui/primitives";

export const metadata = { title: "My shipments" };

const GROUPS: Record<string, { label: string; statuses: string[] }> = {
  respond: { label: "To respond", statuses: ["requested"] },
  ship: { label: "To ship", statuses: ["accepted"] },
  transit: { label: "In transit", statuses: ["shipped"] },
  delivered: { label: "Delivered", statuses: ["delivered"] },
  done: { label: "Completed", statuses: ["completed"] },
  closed: { label: "Cancelled & disputed", statuses: ["cancelled", "declined", "expired", "disputed", "refunded"] },
};

export default async function MyShipments({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const u = await requireUser("/my/shipments");
  await runJobsIfDue();
  const { tab = "respond" } = await searchParams;
  const all = await exchangesFor(u.id, "sender");
  const g = GROUPS[tab] ?? GROUPS.respond;
  return (
    <div className="container page">
      <h1>My shipments</h1>
      <p className="muted">Requests for your books, and books you&apos;ve sent.</p>
      <Tabs
        current={tab}
        items={Object.entries(GROUPS).map(([k, v]) => ({
          key: k,
          href: `/my/shipments?tab=${k}`,
          label: `${v.label} (${all.filter((e) => v.statuses.includes(e.status)).length})`,
        }))}
      />
      <ExchangeList
        items={all.filter((e) => g.statuses.includes(e.status))}
        side="sender"
        empty="Nothing here right now."
      />
    </div>
  );
}
