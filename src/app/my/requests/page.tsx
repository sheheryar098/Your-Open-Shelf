import Link from "next/link";
import { requireUser } from "@/shared/api/session";
import { exchangesFor } from "@/server/domain/exchanges/queries";
import { runJobsIfDue } from "@/server/jobs/runner";
import { ExchangeList } from "@/features/exchanges/components/ExchangeList";
import { Tabs } from "@/shared/ui/primitives";

export const metadata = { title: "My requests" };

const GROUPS: Record<string, { label: string; statuses: string[] }> = {
  waiting: { label: "Waiting for sender", statuses: ["requested"] },
  accepted: { label: "Accepted", statuses: ["accepted"] },
  transit: { label: "In transit", statuses: ["shipped"] },
  confirm: { label: "Delivered", statuses: ["delivered"] },
  done: { label: "Completed", statuses: ["completed"] },
  closed: { label: "Cancelled & disputed", statuses: ["cancelled", "declined", "expired", "disputed", "refunded"] },
};

export default async function MyRequests({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const u = await requireUser("/my/requests");
  await runJobsIfDue();
  const { tab = "waiting" } = await searchParams;
  const all = await exchangesFor(u.id, "requester");
  const g = GROUPS[tab] ?? GROUPS.waiting;
  return (
    <div className="container page">
      <h1>My requests</h1>
      <p className="muted">Books you&apos;ve requested from other members.</p>
      <Tabs
        current={tab}
        items={Object.entries(GROUPS).map(([k, v]) => ({
          key: k,
          href: `/my/requests?tab=${k}`,
          label: `${v.label} (${all.filter((e) => v.statuses.includes(e.status)).length})`,
        }))}
      />
      <ExchangeList
        items={all.filter((e) => g.statuses.includes(e.status))}
        side="requester"
        empty={
          <>
            Nothing here. <Link href="/explore">Explore books</Link>
          </>
        }
      />
    </div>
  );
}
