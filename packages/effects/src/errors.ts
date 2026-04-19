/** Thrown when invoke() is called outside an active dispatch-boundary middleware. */
export class InvalidInvokeCallSiteError extends Error {
  override name = "InvalidInvokeCallSiteError" as const;
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when invoke() is called with malformed fn or args. */
export class InvalidInvokeInputError extends Error {
  override name = "InvalidInvokeInputError" as const;
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when invoke() is called with malformed opts (overlay shape, label type). */
export class InvalidInvokeOptionError extends Error {
  override name = "InvalidInvokeOptionError" as const;
  constructor(message: string) {
    super(message);
  }
}
