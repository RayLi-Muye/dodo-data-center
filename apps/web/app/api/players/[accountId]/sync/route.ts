import {
  accountIdParamsSchema,
  syncJobResponseSchema,
  type ApiError,
} from "@dodo/contracts";
import { NextResponse } from "next/server";

import { DodoApiError, fetchApi } from "../../../../../lib/api";

export const preferredRegion = "hnd1";

export async function POST(_request: Request, context: { params: Promise<{ accountId: string }> }) {
  const params = accountIdParamsSchema.safeParse(await context.params);
  if (!params.success) {
    const invalid: ApiError = {
      error: { code: "INVALID_ACCOUNT_ID", message: "Dota 账号 ID 格式不正确。", retryable: false },
    };
    return NextResponse.json(invalid, { status: 400 });
  }

  try {
    const result = await fetchApi(
      syncJobResponseSchema,
      `/v1/players/${encodeURIComponent(params.data.accountId)}/sync`,
      { method: "POST" },
    );
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    if (error instanceof DodoApiError && error.payload) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    const unavailable: ApiError = {
      error: { code: "SOURCE_UNAVAILABLE", message: "玩家同步服务暂时无法连接，请稍后重试。", retryable: true },
    };
    return NextResponse.json(unavailable, { status: 503 });
  }
}
