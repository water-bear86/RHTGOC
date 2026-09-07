export class ScrollAdapterError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = "ScrollAdapterError"
  }
}

export class AuthenticationRequiredError extends ScrollAdapterError {
  constructor() {
    super("A connected wallet is required for canonical Scroll state", "AUTHENTICATION_REQUIRED", 401)
    this.name = "AuthenticationRequiredError"
  }
}

export class StateUnavailableError extends ScrollAdapterError {
  constructor() {
    super("Load player state before queueing progress", "STATE_UNAVAILABLE")
    this.name = "StateUnavailableError"
  }
}

export class StateConflictError extends ScrollAdapterError {
  constructor(readonly currentVersion?: number) {
    super("The canonical Scroll state changed before this mutation was applied", "STATE_CONFLICT", 409)
    this.name = "StateConflictError"
  }
}
