import Link from "next/link";
import { requireUser } from "@/shared/api/session";
import { LANGUAGES } from "@/shared/lib/vocab";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { CountrySelect } from "@/shared/ui/primitives";
import { Photo } from "@/shared/ui/book-media";
import { profileAction } from "@/features/accounts/api/actions";

export const metadata = { title: "Profile settings" };

const ZONES = Intl.supportedValuesOf("timeZone");

export default async function ProfileSettings() {
  const u = await requireUser("/settings/profile");
  return (
    <section className="card">
      <div className="card-header"><h2>Profile</h2><Link href={`/members/${u.id}`} className="small">View public profile</Link></div>
      <ActionForm action={profileAction} encType="multipart/form-data">
        <div className="field">
          <label htmlFor="displayName">Display name</label>
          <input id="displayName" name="displayName" type="text" required minLength={2} maxLength={40} defaultValue={u.display_name} />
        </div>
        <div className="field">
          <label htmlFor="bio">Short bio (optional)</label>
          <textarea id="bio" name="bio" maxLength={500} rows={3} defaultValue={u.bio ?? ""} placeholder="What do you like to read?" />
        </div>
        <div className="field">
          <label htmlFor="avatar">Profile photo (optional)</label>
          {u.avatar_file_id && <div style={{ width: 64, height: 64, borderRadius: "50%", overflow: "hidden" }}><Photo fileId={u.avatar_file_id} alt="Your profile photo" /></div>}
          <input id="avatar" name="avatar" type="file" accept="image/jpeg,image/png,image/webp" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="country">Country</label>
            <CountrySelect defaultValue={u.country_code} />
            <span className="help">Shown publicly as your general location. Your listings ship from here.</span>
          </div>
          <div className="field">
            <label htmlFor="preferredLanguage">Preferred language</label>
            <select id="preferredLanguage" name="preferredLanguage" defaultValue={u.preferred_language}>
              <option value="en">English</option>
            </select>
            <span className="help">More languages are coming. {LANGUAGES.en} is the launch language.</span>
          </div>
          <div className="field">
            <label htmlFor="timezone">Time zone</label>
            <select id="timezone" name="timezone" defaultValue={u.timezone}>
              <option value="UTC">UTC</option>
              {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
        </div>
        <p className="small muted">Email: {u.email} (private)</p>
        <SubmitButton>Save profile</SubmitButton>
      </ActionForm>
    </section>
  );
}
