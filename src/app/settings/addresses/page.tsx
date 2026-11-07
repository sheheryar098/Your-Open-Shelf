import { requireUser } from "@/shared/api/session";
import { addressesFor, type Address } from "@/server/domain/support";
import { addressLabels, countryName } from "@/shared/lib/countries";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { CountrySelect, Empty } from "@/shared/ui/primitives";
import { deleteAddressAction, saveAddressAction } from "@/features/accounts/api/actions";

export const metadata = { title: "Addresses" };

function AddressFields({ a, country, back }: { a?: Address; country: string | null; back?: string }) {
  const labels = addressLabels(a?.country_code ?? country);
  const p = a?.id ?? "new";
  return (
    <>
      {back && <input type="hidden" name="back" value={back} />}
      <div className="field-row">
        <div className="field">
          <label htmlFor={`rn-${p}`}>Recipient name</label>
          <input
            id={`rn-${p}`}
            name="recipientName"
            type="text"
            required
            defaultValue={a?.recipient_name}
            autoComplete="name"
          />
        </div>
        <div className="field">
          <label htmlFor={`lb-${p}`}>Label (optional)</label>
          <input
            id={`lb-${p}`}
            name="label"
            type="text"
            maxLength={40}
            defaultValue={a?.label ?? ""}
            placeholder="Home, Work…"
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`l1-${p}`}>Address line 1</label>
        <input id={`l1-${p}`} name="line1" type="text" required defaultValue={a?.line1} autoComplete="address-line1" />
      </div>
      <div className="field">
        <label htmlFor={`l2-${p}`}>Address line 2 (optional)</label>
        <input id={`l2-${p}`} name="line2" type="text" defaultValue={a?.line2 ?? ""} autoComplete="address-line2" />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`ci-${p}`}>City / locality</label>
          <input id={`ci-${p}`} name="city" type="text" required defaultValue={a?.city} autoComplete="address-level2" />
        </div>
        <div className="field">
          <label htmlFor={`rg-${p}`}>{labels.region}</label>
          <input
            id={`rg-${p}`}
            name="region"
            type="text"
            required={labels.regionRequired}
            defaultValue={a?.region ?? ""}
            autoComplete="address-level1"
          />
        </div>
        <div className="field">
          <label htmlFor={`pc-${p}`}>{labels.postal}</label>
          <input
            id={`pc-${p}`}
            name="postalCode"
            type="text"
            required={labels.postalRequired}
            defaultValue={a?.postal_code ?? ""}
            autoComplete="postal-code"
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`co-${p}`}>Country</label>
          <CountrySelect id={`co-${p}`} defaultValue={a?.country_code ?? country} />
        </div>
        <div className="field">
          <label htmlFor={`ph-${p}`}>Phone (only if your carrier or customs needs it)</label>
          <input id={`ph-${p}`} name="phone" type="tel" defaultValue={a?.phone ?? ""} autoComplete="tel" />
        </div>
      </div>
      <label className="check small">
        <input type="checkbox" name="isDefault" defaultChecked={a?.is_default} /> Use as my default delivery address
      </label>
    </>
  );
}

export default async function Addresses({ searchParams }: { searchParams: Promise<{ back?: string }> }) {
  const u = await requireUser("/settings/addresses");
  const { back } = await searchParams;
  const safeBack = back?.startsWith("/") && !back.startsWith("//") ? back : undefined;
  const list = await addressesFor(u.id);
  return (
    <>
      <section>
        <h2>Delivery addresses</h2>
        <p className="small muted">
          Private. A sender sees the address you choose only after accepting your request, and only for that exchange.
        </p>
        {list.length === 0 ? (
          <Empty>No saved addresses yet.</Empty>
        ) : (
          <div className="stack">
            {list.map((a) => (
              <details key={a.id} className="card card-flat">
                <summary>
                  {a.label ? `${a.label}: ` : ""}
                  {a.recipient_name}, {a.line1}, {a.city}, {countryName(a.country_code)}{" "}
                  {a.is_default && <span className="badge badge-accent">Default</span>}
                </summary>
                <ActionForm action={saveAddressAction.bind(null, a.id)}>
                  <AddressFields a={a} country={u.country_code} />
                  <div className="row">
                    <SubmitButton className="btn btn-sm">Save</SubmitButton>
                  </div>
                </ActionForm>
                <ActionForm
                  action={deleteAddressAction.bind(null, a.id)}
                  confirm="Delete this address?"
                  className="inline-form"
                >
                  <SubmitButton className="btn btn-danger btn-sm">Delete</SubmitButton>
                </ActionForm>
              </details>
            ))}
          </div>
        )}
      </section>
      <section className="card">
        <h2>Add an address</h2>
        <ActionForm action={saveAddressAction.bind(null, null)} resetOnSuccess>
          <AddressFields country={u.country_code} back={safeBack} />
          <SubmitButton>Save address</SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}
