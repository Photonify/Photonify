/**
 * The single error type Photonify throws. Every rejection from the public API
 * is a `PhotonifyError`, so callers can branch with `instanceof` instead of
 * sniffing the message string. When the failure originates elsewhere (a sharp
 * decode error, an S3 transport error) it is attached as `cause`.
 */
export class PhotonifyError extends Error {
  // Declared explicitly so `cause` is on the emitted .d.ts even when the
  // consumer's lib is below ES2022 (where `Error.cause` does not exist).
  readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'PhotonifyError';
    if (options && 'cause' in options) {
      this.cause = options.cause;
    }
    // Restore the prototype chain so `instanceof` holds when this class is
    // down-levelled by TypeScript's compilation target.
    Object.setPrototypeOf(this, PhotonifyError.prototype);
  }
}
