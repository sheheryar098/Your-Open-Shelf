import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { createTicketAction } from "@/app/actions/support";
import { TICKET_CATEGORIES } from "@/lib/vocab";

export const metadata = { title: "Contact us" };

export default async function Contact() {
  if (await currentUser()) redirect("/support/new");
  return (
    <div className="container tight page">
      <h1>Contact us</h1>
      <p className="muted">Can&apos;t sign in, or not a member yet? Send us a message and we&apos;ll reply by email.</p>
      <ActionForm action={createTicketAction} resetOnSuccess>
        <div className="field"><label htmlFor="email">Your email</label><input id="email" name="email" type="email" required /></div>
        <div className="field">
          <label htmlFor="category">Topic</label>
          <select id="category" name="category" defaultValue="general">
            {Object.entries(TICKET_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="subject">Subject</label><input id="subject" name="subject" type="text" required maxLength={200} /></div>
        <div className="field"><label htmlFor="body">Message</label><textarea id="body" name="body" required rows={6} /></div>
        <div className="sr-only" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <p className="tiny muted">Please don&apos;t include passwords or payment details.</p>
        <SubmitButton>Send message</SubmitButton>
      </ActionForm>
    </div>
  );
}
