import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container tight page center">
      <h1>Page not found</h1>
      <p className="muted">This page may have moved, or the book has found its next reader.</p>
      <div className="row" style={{ justifyContent: "center" }}>
        <Link href="/explore" className="btn btn-primary">Explore books</Link>
        <Link href="/" className="btn">Home</Link>
      </div>
    </div>
  );
}
