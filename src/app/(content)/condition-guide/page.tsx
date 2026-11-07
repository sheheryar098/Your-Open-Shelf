import { CONDITIONS, NOT_EXCHANGEABLE } from "@/lib/vocab";

export const metadata = { title: "Book condition guide" };

export default function ConditionGuide() {
  return (
    <div className="container narrow page prose">
      <h1>Book condition guide</h1>
      <p className="lede">
        Every YOS listing uses the same four condition grades, backed by photos of the actual copy and a written description of
        any wear or defects.
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Condition</th><th>What it means</th></tr></thead>
          <tbody>
            {Object.entries(CONDITIONS).map(([k, c]) => (
              <tr key={k}><td><strong>{c.label}</strong></td><td>{c.guidance}</td></tr>
            ))}
            <tr><td><strong>Not exchangeable</strong></td><td>Missing pages, unreadable, unsafe, counterfeit, water-damaged beyond policy, or otherwise ineligible. Don&apos;t list these.</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Books that can&apos;t be exchanged</h2>
      <ul>{NOT_EXCHANGEABLE.map((x) => <li key={x}>{x}</li>)}</ul>

      <h2>Describing your copy honestly</h2>
      <ul>
        <li>Photograph the actual copy: front, back, spine, and any damage, notes or highlighting.</li>
        <li>“Good” must never hide a defect that would reasonably change someone&apos;s mind. If in doubt, disclose it.</li>
        <li>Note the edition, language and format accurately — especially for textbooks, where the edition matters.</li>
        <li>Collectible, signed or unusual editions should be clearly described; YOS doesn&apos;t authenticate or appraise books.</li>
      </ul>

      <h2 id="packing">Packing your book</h2>
      <ul>
        <li>Use a suitable padded mailer or a snug box.</li>
        <li>Protect corners and covers — a layer of card on each side works well.</li>
        <li>Stop the book moving inside the package.</li>
        <li>Wrap it against ordinary moisture (a simple bag is fine).</li>
        <li>Keep labels readable and secure, and don&apos;t tape directly onto the book.</li>
        <li>Follow your carrier&apos;s size and weight limits.</li>
      </ul>
    </div>
  );
}
