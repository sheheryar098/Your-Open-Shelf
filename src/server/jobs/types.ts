/**
 * A scheduled job over many items (background-jobs skill): `find` returns identifiers only,
 * `handle` processes one item in its own transaction and must be safe to run twice.
 */
export interface DueItemJob {
  find(t: Date, limit: number): Promise<string[]>;
  /** Returns true if it changed something, false if there was nothing (left) to do. */
  handle(id: string, t: Date): Promise<boolean>;
}
