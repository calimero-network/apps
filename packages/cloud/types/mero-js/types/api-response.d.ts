export type ErrorResponse = {
    code?: number;
    message: string;
};
export type ResponseData<D = unknown> = {
    data: D;
    error: null;
} | {
    data: null;
    error: ErrorResponse;
};
export type ApiResponse<D = unknown> = Promise<ResponseData<D>>;
export interface SuccessResponse {
    success: boolean;
}
