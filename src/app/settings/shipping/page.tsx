import Link from "next/link";
import { requireUser } from "@/shared/api/session";
import { enabledRoutes } from "@/server/domain/routes";
import { countryName } from "@/shared/lib/countries";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { shippingPrefsAction } from "@/features/accounts/api/actions";

export const metadata = { title: "Shipping preferences" };

export default async function ShippingSettings() {
  const u = await requireUser("/settings/shipping");
  const routes = await enabledRoutes();
  const intl = routes.filter((r) => r.origin_country === u.country_code && r.destination_country !== u.country_code);
  return (
    <section className="card">
      <h2>Shipping preferences</h2>
      <p className="small muted">
        Defaults for new listings. You always pay outgoing postage, so only offer destinations you&apos;re happy to post
        to. <Link href="/shipping">Routes, tracking &amp; customs</Link>
      </p>
      <ActionForm action={shippingPrefsAction}>
        <div className="radio-cards">
          <label>
            <input type="radio" name="shipScope" value="domestic" defaultChecked={u.ship_scope === "domestic"} />
            <span>
              <strong>Only within {u.country_code ? countryName(u.country_code) : "my country"}</strong>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="shipScope"
              value="international"
              defaultChecked={u.ship_scope === "international"}
              disabled={intl.length === 0}
            />
            <span>
              <strong>Also on supported international routes</strong>
              <br />
              <span className="small muted">
                {intl.length
                  ? intl.map((r) => countryName(r.destination_country)).join(", ")
                  : "None from your country yet"}
              </span>
            </span>
          </label>
        </div>
        {intl.length > 1 && (
          <fieldset>
            <legend className="small">Limit international shipping to (leave empty for all supported)</legend>
            <div className="row">
              {intl.map((r) => (
                <label key={r.destination_country} className="check small">
                  <input
                    type="checkbox"
                    name="shipCountries"
                    value={r.destination_country}
                    defaultChecked={u.ship_countries.includes(r.destination_country)}
                  />{" "}
                  {countryName(r.destination_country)}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <label className="check small">
          <input type="checkbox" name="applyToListings" /> Also apply to my existing listings
        </label>
        <SubmitButton>Save preferences</SubmitButton>
      </ActionForm>
    </section>
  );
}
