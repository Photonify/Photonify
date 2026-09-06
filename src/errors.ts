/**
 * The single error type Photonify throws. Every rejection from the public API
 * is a `PhotonifyError`, so callers can branch with `instanceof` instead of
 * sniffing the message string. When the failure originates elsewhere (a sharp
 * decode error, an S3 transport error) it is attached as `cause`.
 */
export class PhotonifyError extends Error {
  // `declare` puts `cause` on the emitted .d.ts (so consumers whose lib is
  // below ES2022 can read it) without emitting a class field. A real field
  // would, under ES2022's useDefineForClassFields, define an own `cause`
  // property on every instance — making `'cause' in err` true and printing
  // `{ cause: undefined }` even when no cause was passed.
  declare readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'PhotonifyError';
    if (options && 'cause' in options) {
      this.cause = options.cause;
    }
    // Defensive: keep `instanceof` working if the compile target is ever
    // lowered to one that emits a down-levelled (function-based) class.
    Object.setPrototypeOf(this, PhotonifyError.prototype);
  }
}
