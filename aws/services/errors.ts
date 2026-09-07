export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export const badRequest = (code: string, message: string) =>
  new ServiceError(code, message, 400);

export const unauthorized = (code = "unauthorized", message = "Authentication required") =>
  new ServiceError(code, message, 401);

export const forbidden = (code: string, message: string) =>
  new ServiceError(code, message, 403);

export const notFound = (code: string, message: string) =>
  new ServiceError(code, message, 404);

export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new ServiceError(code, message, 409, details);

export const unavailable = (code: string, message: string) =>
  new ServiceError(code, message, 503);
