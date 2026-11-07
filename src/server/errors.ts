/** An expected, user-facing failure (validation, business rule). Safe to show its message. */
export class DomainError extends Error {
  constructor(message: string, public code = "domain_error") {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(what = "Item") {
    super(`${what} not found.`, "not_found");
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "You don't have permission to do that.") {
    super(message, "forbidden");
  }
}

export function assert(cond: unknown, message: string, code?: string): asserts cond {
  if (!cond) throw new DomainError(message, code);
}
