import type { ShippingRoute } from "@/server/domain/routes";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { CountrySelect } from "@/shared/ui/primitives";
import { routeAction } from "../api/actions";

/** Create or edit a shipping route. Saving always records a reason in the audit log. */
export function RouteForm({
  r,
  origin,
  destination,
}: {
  r?: ShippingRoute | null;
  origin?: string;
  destination?: string;
}) {
  return (
    <ActionForm action={routeAction}>
      <div className="field-row">
        <div className="field">
          <label>From</label>
          <CountrySelect name="origin" id={`o-${r?.id ?? "new"}`} defaultValue={r?.origin_country ?? origin} />
        </div>
        <div className="field">
          <label>To</label>
          <CountrySelect
            name="destination"
            id={`d-${r?.id ?? "new"}`}
            defaultValue={r?.destination_country ?? destination}
          />
        </div>
        <div className="field">
          <label>Risk level</label>
          <select name="risk" defaultValue={r?.risk_level ?? "medium"}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>
      <div className="row">
        <label className="check small">
          <input type="checkbox" name="enabled" defaultChecked={r?.enabled} /> Enabled
        </label>
        <label className="check small">
          <input type="checkbox" name="trackingAvailable" defaultChecked={r?.tracking_available ?? true} /> Tracking
          available
        </label>
        <label className="check small">
          <input type="checkbox" name="trackingRequired" defaultChecked={r?.tracking_required ?? true} /> Tracking
          required
        </label>
        <label className="check small">
          <input type="checkbox" name="customsRequired" defaultChecked={r?.customs_required} /> Customs documents
          required
        </label>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Min delivery days</label>
          <input name="minDays" type="number" min={0} defaultValue={r?.min_delivery_days ?? ""} />
        </div>
        <div className="field">
          <label>Max delivery days</label>
          <input name="maxDays" type="number" min={0} defaultValue={r?.max_delivery_days ?? ""} />
        </div>
        <div className="field">
          <label>Max weight (g)</label>
          <input name="maxWeight" type="number" min={1} defaultValue={r?.max_weight_grams ?? ""} />
        </div>
        <div className="field">
          <label>Postage estimate min</label>
          <input name="postageMin" type="number" step="0.01" min={0} defaultValue={r?.postage_estimate_min ?? ""} />
        </div>
        <div className="field">
          <label>Postage estimate max</label>
          <input name="postageMax" type="number" step="0.01" min={0} defaultValue={r?.postage_estimate_max ?? ""} />
        </div>
        <div className="field">
          <label>Currency</label>
          <input
            name="postageCurrency"
            type="text"
            maxLength={3}
            defaultValue={r?.postage_currency ?? ""}
            placeholder="GBP"
          />
        </div>
      </div>
      <div className="field">
        <label>Carrier guidance</label>
        <input name="carrierGuidance" type="text" defaultValue={r?.carrier_guidance ?? ""} />
      </div>
      <div className="field">
        <label>Customs notice (shown to members)</label>
        <textarea name="customsNotice" rows={2} defaultValue={r?.customs_notice ?? ""} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Restricted content notes</label>
          <input name="restricted" type="text" defaultValue={r?.restricted_content_notes ?? ""} />
        </div>
        <div className="field">
          <label>Support escalation notes (internal)</label>
          <input name="supportNotes" type="text" defaultValue={r?.support_notes ?? ""} />
        </div>
      </div>
      <div className="row">
        <input
          name="reason"
          type="text"
          required
          minLength={5}
          placeholder="Reason for change (audit log)"
          aria-label="Reason"
          style={{ flex: 1, minWidth: 200 }}
        />
        <SubmitButton className="btn btn-sm">Save route</SubmitButton>
      </div>
      <p className="tiny muted">
        Only enable a route after carrier coverage, customs requirements and support procedures have been checked
        (§4.3). Postage estimates must come from real carrier services.
      </p>
    </ActionForm>
  );
}
