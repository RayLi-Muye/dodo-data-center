import { syncJobParamsSchema, syncJobResponseSchema, type ApiError } from "@dodo/contracts";
import { NextResponse } from "next/server";

import { DodoApiError, fetchApi } from "../../../../lib/api";

export const preferredRegion = "hnd1";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const params = syncJobParamsSchema.safeParse(await context.params);
  if (!params.success) {
    const invalid: ApiError = {
      error: { code: "VALIDATION_ERROR", message: "同步任务 ID 格式不正确。", retryable: false },
    };
    return NextResponse.json(invalid, { status: 400 });
  }

  try {
    const result = await fetchApi(
      syncJobResponseSchema,
      `/v1/sync-jobs/${encodeURIComponent(params.data.jobId)}`,
      { cache: "no-store" },
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DodoApiError && error.payload) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    const unavailable: ApiError = {
      error: { code: "SOURCE_UNAVAILABLE", message: "同步状态服务暂时无法连接，请稍后重试。", retryable: true },
    };
    return NextResponse.json(unavailable, { status: 503 });
  }
}
