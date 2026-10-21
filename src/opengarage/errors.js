// -----------------------------------------------------------------------------
// The failures of a request to a controller, by kind. Messages are our own
// words only: never an address, a path (it carries the device key), a header
// or a body.
// -----------------------------------------------------------------------------

/**
 * - timeout:     no complete answer in time
 * - unreachable: no connection, or a connection lost
 * - late:        a command could not leave before its deadline (nothing sent)
 * - busy:        HTTP 429 or 5xx, the controller asks for a pause
 * - http:        another HTTP status
 * - invalid:     not the JSON an OpenGarage controller answers
 * - tooLarge:    the answer exceeds the size cap
 */
export class OpenGarageError extends Error {
  constructor(kind, { status, sent = false, retryAfter } = {}) {
    super(status ? `${kind} (HTTP ${status})` : kind);
    this.name = 'OpenGarageError';
    this.kind = kind;
    this.status = status;
    this.sent = sent;
    this.retryAfter = retryAfter;
  }
}

/** A short reason for the logs and the user: the kind, and the status if any. */
export const reasonOf = (err) =>
  err instanceof OpenGarageError ? err.message : 'unexpected error';
