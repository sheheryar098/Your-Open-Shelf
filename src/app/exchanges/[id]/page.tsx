import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/shared/api/session";
import { getExchangeForViewer } from "@/server/domain/exchanges/queries";
import { runJobsIfDue } from "@/server/jobs/runner";
import { policy } from "@/server/config";
import { now } from "@/server/clock";
import { isUuid } from "@/shared/lib/ids";
import { ExchangeHeader } from "@/features/exchanges/components/ExchangeHeader";
import { ExchangeSidebar } from "@/features/exchanges/components/ExchangeSidebar";
import { MessageThread } from "@/features/exchanges/components/MessageThread";
import { RespondToRequest, ShipBook } from "@/features/exchanges/components/SenderPanels";
import { AwaitingDispatch, AwaitingResponse, ConfirmReceipt } from "@/features/exchanges/components/RequesterPanels";
import {
  ClosedSummary,
  CompletedSummary,
  ReportProblem,
  UnderReview,
} from "@/features/exchanges/components/OutcomePanels";
import { ReportForm } from "@/features/support/components/ReportForm";

export const metadata = { title: "Exchange" };

const CLOSED = new Set(["declined", "expired", "cancelled", "refunded"]);

export default async function ExchangePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ requested?: string }>;
}) {
  const user = await requireUser("/dashboard");
  const { id } = await params;
  const { requested } = await searchParams;
  if (!isUuid(id)) notFound();

  await runJobsIfDue();
  const view = await getExchangeForViewer(id, user);
  if (!view) notFound();

  const { exchange: e, viewer, messages, disputes } = view;
  const timeZone = user.timezone;
  const inTransit = e.status === "shipped" || e.status === "delivered";
  const openDispute = disputes.find((d) => d.status !== "resolved");
  const isParty = viewer.isRequester || viewer.isSender;

  return (
    <div className="container page stack-lg">
      <p className="small">
        <Link href={viewer.isSender ? "/my/shipments" : "/my/requests"}>
          ← {viewer.isSender ? "My shipments" : "My requests"}
        </Link>
        {viewer.isStaff && !isParty && (
          <>
            {" · "}
            <Link href={`/admin/exchanges/${e.id}`}>Staff view</Link>
          </>
        )}
      </p>
      {requested && (
        <div className="alert alert-ok">
          Request sent. 1 credit is reserved, and {e.sender_name} has {policy.senderResponseDays} days to respond.
        </div>
      )}

      <ExchangeHeader view={view} />

      <div className="split">
        <div className="stack">
          {viewer.isSender && e.status === "requested" && <RespondToRequest view={view} />}
          {viewer.isSender && e.status === "accepted" && (
            <ShipBook view={view} timeZone={timeZone} today={now().toISOString().slice(0, 10)} />
          )}
          {viewer.isRequester && e.status === "requested" && <AwaitingResponse view={view} timeZone={timeZone} />}
          {viewer.isRequester && e.status === "accepted" && <AwaitingDispatch view={view} timeZone={timeZone} />}
          {viewer.isRequester && inTransit && <ConfirmReceipt view={view} timeZone={timeZone} />}
          {inTransit && isParty && <ReportProblem exchangeId={e.id} />}
          {e.status === "disputed" && openDispute && <UnderReview dispute={openDispute} />}
          {CLOSED.has(e.status) && <ClosedSummary view={view} />}
          {e.status === "completed" && <CompletedSummary view={view} viewerId={user.id} />}

          {(isParty || messages.length > 0) && (
            <MessageThread
              exchangeId={e.id}
              messages={messages}
              viewerId={user.id}
              counterpart={viewer.isRequester ? e.sender_name : e.requester_name}
              canWrite={isParty}
              timeZone={timeZone}
              messageFooter={
                isParty ? (m) => <ReportForm targetType="message" targetId={m.id} label="Report" /> : undefined
              }
            />
          )}
        </div>

        <ExchangeSidebar view={view} timeZone={timeZone} />
      </div>
    </div>
  );
}
