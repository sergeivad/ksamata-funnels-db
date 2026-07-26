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

/**
 * Thrown when the request collides with existing data (a taken funnel `num`).
 * Maps to HTTP 409.
 *
 * Раньше конфликт различали по `message.includes('409')` — то есть любая
 * посторонняя ошибка, где в тексте попадалось «409» (номер строки, кусок URL),
 * превращалась в «такая воронка уже есть», и настоящая причина терялась.
 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
