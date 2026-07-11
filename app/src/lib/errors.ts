/**
 * Typed errors so route handlers can distinguish user-input problems (→ 400)
 * from unexpected/DB failures (→ 500 via internalError) without matching on
 * fragile error-message strings.
 */

/** Thrown when caller-supplied data fails a domain rule. Maps to HTTP 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
