import { authorsText } from "@/shared/lib/format";

function hashHue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Placeholder cover drawn from the title. We don't show publisher cover art until we have a licence for it. */
export function Cover({ title, authors }: { title: string; authors?: string[] }) {
  // Deep, muted bindings: the cream title lettering stays readable on every hue.
  const hue = hashHue(title);
  return (
    <div
      className="cover"
      style={{ background: `linear-gradient(160deg, hsl(${hue} 40% 26%), hsl(${(hue + 20) % 360} 36% 38%))` }}
      aria-hidden="true"
    >
      <div className="t">{title}</div>
      <div className="a">{authorsText(authors)}</div>
    </div>
  );
}

export function Photo({ fileId, alt }: { fileId: string; alt: string }) {
  return <img src={`/files/${fileId}`} alt={alt} loading="lazy" />;
}

/** A member's actual-copy photo when there is one, otherwise the generated cover. */
export function BookMedia({ title, authors, photoId }: { title: string; authors: string[]; photoId: string | null }) {
  if (photoId) {
    return (
      <div className="cover-photo">
        <Photo fileId={photoId} alt={`Photo of the member's copy of ${title}`} />
      </div>
    );
  }
  return <Cover title={title} authors={authors} />;
}
