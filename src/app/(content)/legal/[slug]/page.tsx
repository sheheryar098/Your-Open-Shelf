import Link from "next/link";
import { notFound } from "next/navigation";
import { POLICIES } from "@/features/content/model/policies";
import { policy } from "@/server/config";

export function generateStaticParams() {
  return Object.keys(POLICIES).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: POLICIES[slug]?.title ?? "Policy" };
}

export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = POLICIES[slug];
  if (!doc) notFound();
  return (
    <div className="container narrow page prose">
      <p className="small">
        <Link href="/legal">← All policies</Link>
      </p>
      <h1>{doc.title}</h1>
      <p className="small muted">Version {policy.termsVersion} · Draft pending legal review. Not legal advice.</p>
      {doc.body}
    </div>
  );
}
