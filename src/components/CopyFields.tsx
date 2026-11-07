import { CONDITIONS, FORMATS, LANGUAGES } from "@/lib/vocab";
import { countryName } from "@/lib/countries";
import { query } from "@/lib/db";
import { enabledRoutes } from "@/domain/routes";

export interface CopyDefaults {
  format?: string;
  language?: string;
  condition?: string;
  condition_notes?: string;
  edition_notes?: string | null;
  category_id?: number | null;
  weight_grams?: number | null;
  ship_scope?: string;
  ship_countries?: string[];
}

/** Fields describing the member's individual copy (§7.3), shared by create and edit. */
export async function CopyFields({ d, origin }: { d: CopyDefaults; origin: string | null }) {
  const [categories, routes] = await Promise.all([
    query<{ id: number; name: string; parent_id: number | null }>("SELECT id, name, parent_id FROM categories ORDER BY sort"),
    enabledRoutes(),
  ]);
  const intlDestinations = routes.filter((r) => r.origin_country === origin && r.destination_country !== origin).map((r) => r.destination_country);
  return (
    <>
      <div className="field-row">
        <div className="field">
          <label htmlFor="format">Format</label>
          <select id="format" name="format" required defaultValue={d.format ?? "paperback"}>
            {Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="language">Language of this copy</label>
          <select id="language" name="language" required defaultValue={d.language ?? "en"}>
            {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="categoryId">Category</label>
          <select id="categoryId" name="categoryId" defaultValue={d.category_id ?? ""}>
            <option value="">Choose…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.parent_id ? "— " : ""}{c.name}</option>)}
          </select>
        </div>
      </div>

      <fieldset>
        <legend>Condition</legend>
        <div className="radio-cards">
          {Object.entries(CONDITIONS).map(([k, c]) => (
            <label key={k}>
              <input type="radio" name="condition" value={k} required defaultChecked={(d.condition ?? "") === k} />
              <span><strong>{c.label}</strong><br /><span className="small muted">{c.guidance}</span></span>
            </label>
          ))}
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Missing pages, detached covers, mold, pests, severe water damage, strong odors or counterfeit copies can&apos;t be listed.
        </p>
      </fieldset>

      <div className="field">
        <label htmlFor="conditionNotes">Describe this copy&apos;s condition</label>
        <textarea id="conditionNotes" name="conditionNotes" required minLength={10} maxLength={2000} defaultValue={d.condition_notes ?? ""}
          placeholder="e.g. Spine creased, light pencil underlining in chapter 2, small coffee stain on the back cover." />
        <span className="help">Disclose any wear, writing, highlighting, stains or damage. Honest notes prevent disputes.</span>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="editionNotes">Edition details (optional)</label>
          <input id="editionNotes" name="editionNotes" type="text" maxLength={300} defaultValue={d.edition_notes ?? ""} placeholder="e.g. 3rd edition, Penguin Classics, 2003 printing" />
        </div>
        <div className="field">
          <label htmlFor="weightGrams">Approximate weight in grams (optional)</label>
          <input id="weightGrams" name="weightGrams" type="number" min={1} max={30000} defaultValue={d.weight_grams ?? ""} />
        </div>
      </div>

      <fieldset>
        <legend>Where will you ship this book?</legend>
        <div className="radio-cards">
          <label>
            <input type="radio" name="shipScope" value="domestic" defaultChecked={(d.ship_scope ?? "domestic") === "domestic"} />
            <span><strong>Within {origin ? countryName(origin) : "my country"} only</strong><br /><span className="small muted">Usually cheapest and fastest.</span></span>
          </label>
          <label>
            <input type="radio" name="shipScope" value="international" defaultChecked={d.ship_scope === "international"} disabled={intlDestinations.length === 0} />
            <span>
              <strong>Also internationally</strong><br />
              <span className="small muted">
                {intlDestinations.length ? `Supported routes: ${intlDestinations.map((c) => countryName(c)).join(", ")}. Postage costs more and customs forms apply.` : "No international routes from your country yet."}
              </span>
            </span>
          </label>
        </div>
        {intlDestinations.length > 1 && (
          <details style={{ marginTop: 8 }}>
            <summary className="small">Limit to specific countries</summary>
            <div className="row">
              {intlDestinations.map((c) => (
                <label key={c} className="check small"><input type="checkbox" name="shipCountries" value={c} defaultChecked={d.ship_countries?.includes(c)} /> {countryName(c)}</label>
              ))}
            </div>
            <p className="tiny muted">Leave all unticked to ship to every supported route.</p>
          </details>
        )}
      </fieldset>
    </>
  );
}
