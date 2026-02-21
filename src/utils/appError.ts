export type ErrorDetails = Record<string, unknown> | undefined;

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: ErrorDetails;

  constructor(message: string, statusCode: number, code: string, details?: ErrorDetails) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
