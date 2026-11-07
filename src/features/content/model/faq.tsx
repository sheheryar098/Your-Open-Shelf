import type { ReactNode } from "react";

export type Faq = { q: string; a: ReactNode };

export const HOME_FAQ: Faq[] = [
  {
    q: "Is YOS a bookstore?",
    a: "No. YOS is a peer-to-peer book exchange. Members list and send books they own; YOS coordinates the exchange and keeps the credit ledger.",
  },
  {
    q: "Do I need to find someone who wants the exact book I have?",
    a: "No. Send a book to one member, earn a credit, and use it to request a different book from someone else.",
  },
  {
    q: "Do I pay for the book I request?",
    a: "You spend one YOS credit. The sender pays their own outgoing postage. Customs charges on cross-border routes are set by the destination country.",
  },
  {
    q: "Can I convert credits into cash?",
    a: "No. YOS credits have no cash value, can't be transferred, and can only be used to request books on YOS.",
  },
];

export const HELP_FAQ: { section: string; items: Faq[] }[] = [
  {
    section: "Getting started",
    items: [
      ...HOME_FAQ,
      {
        q: "How do I get my first credit?",
        a: "List books you're ready to pass on. When someone requests one and the exchange completes, you earn a credit. YOS doesn't give out free sign-up credits, which keeps the exchange fair and protects it from abuse.",
      },
      {
        q: "Why do I need to verify my email?",
        a: "Verified email is required before you list or request, so exchange notifications reach you and we can keep fake accounts out.",
      },
    ],
  },
  {
    section: "Credits",
    items: [
      {
        q: "How do I earn credits?",
        a: "You earn one credit when a qualifying outgoing exchange completes: you accepted the request, shipped on time with tracking or proof of postage, and the delivery was confirmed with no unresolved dispute.",
      },
      {
        q: "What are reserved and pending credits?",
        a: "Reserved credits are held for requests you've made that are still in progress. Pending credits are ones you'll earn when books you've shipped complete.",
      },
      {
        q: "What happens if my request is declined or expires?",
        a: "The reserved credit returns to your available balance automatically.",
      },
      {
        q: "Do credits expire?",
        a: "No. There's no credit expiry at launch. If that ever changes, we'll give clear notice in advance.",
      },
    ],
  },
  {
    section: "Sending books",
    items: [
      {
        q: "How long do I have to respond and ship?",
        a: "Respond to requests within 3 days, and dispatch within 5 business days of accepting. We can extend deadlines for holidays or carrier disruption, contact support.",
      },
      {
        q: "Who pays postage?",
        a: "The sender pays outgoing postage. You'll see indicative postage information for the route before accepting, where we have it. Check your carrier's current prices.",
      },
      {
        q: "Do I need tracking?",
        a: "Tracking is strongly recommended and required on cross-border routes and some domestic routes. Where it isn't required, you'll need to upload proof of postage instead.",
      },
    ],
  },
  {
    section: "Problems",
    items: [
      {
        q: "What if a book never arrives?",
        a: "Open a dispute from the exchange page. Support reviews tracking, proof of postage, messages and the route policy, and records a decision with a reason.",
      },
      {
        q: "What if the book isn't as described?",
        a: "Report it promptly with photos from the exchange page. Support reviews the listing and your evidence under the condition and dispute policies.",
      },
      {
        q: "Can I appeal a decision?",
        a: "Yes. Open a support ticket within 14 days of the decision, referencing the dispute.",
      },
    ],
  },
];
