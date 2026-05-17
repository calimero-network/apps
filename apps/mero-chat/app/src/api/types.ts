// Local replacements for the response shapes calimero-client used to export.
// Keep the same field names so existing dataSource code (which checks
// `.data` / `.error`) doesn't have to change.

export type ErrorResponse = {
  code?: number;
  message: string;
};

export type ResponseData<D> =
  | { data: D; error?: null }
  | { data?: null; error: ErrorResponse };

export type ApiResponse<T> = Promise<ResponseData<T>>;
