"use client";

import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container tight page center">
      <h1>Something went wrong</h1>
      <p className="muted">
        We&apos;ve logged the problem. Please try again.{error.digest ? ` (Reference ${error.digest})` : ""}
      </p>
      <div className="row" style={{ justifyContent: "center" }}>
        <button className="btn btn-primary" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="btn">
          Home
        </Link>
      </div>
    </div>
  );
}
