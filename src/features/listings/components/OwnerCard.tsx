import Link from "next/link";
import type { publicProfile } from "@/server/domain/support";
import { countryName } from "@/shared/lib/countries";
import { fmtDate, plural } from "@/shared/lib/format";
import { Stars } from "@/shared/ui/primitives";

type Profile = NonNullable<Awaited<ReturnType<typeof publicProfile>>>;

export function OwnerCard({ profile }: { profile: Profile }) {
  const { user } = profile;
  return (
    <section className="card">
      <div className="row-between">
        <div>
          <h3 className="mb-0">
            <Link href={`/members/${user.id}`}>{user.display_name}</Link>
          </h3>
          <div className="small muted">
            {user.country_code && countryName(user.country_code)} · Member since {fmtDate(user.created_at)}
          </div>
        </div>
        <div className="right small">
          {profile.avgRating ? (
            <>
              <Stars value={profile.avgRating} /> ({profile.reviewCount})
            </>
          ) : (
            <span className="muted">No ratings yet</span>
          )}
          <div className="muted">{plural(profile.completed, "completed exchange")}</div>
        </div>
      </div>
    </section>
  );
}
