export type ApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type ApiResponse<T = undefined> = {
  ok: boolean;
  data?: T;
  error?: ApiError;
  meta?: Record<string, unknown>;
};

export const ok = <T>(data?: T, meta?: Record<string, unknown>): ApiResponse<T> => {
  const response: ApiResponse<T> = { ok: true };

  if (data !== undefined) {
    response.data = data;
  }

  if (meta) {
    response.meta = meta;
  }

  return response;
};

export const created = <T>(data?: T, meta?: Record<string, unknown>): ApiResponse<T> => {
  const response: ApiResponse<T> = { ok: true };

  if (data !== undefined) {
    response.data = data;
  }

  if (meta) {
    response.meta = meta;
  }

  return response;
};

export const fail = (error: ApiError): ApiResponse<never> => ({
  ok: false,
  error
});
