import {
  accountIdParamsSchema,
  playerSyncRequestSchema,
  syncJobResponseSchema,
  type ApiError,
} from "@dodo/contracts";
import { NextResponse } from "next/server";

import { DodoApiError, fetchApi } from "../../../../../lib/api";

export const preferredRegion = "hnd1";

const invalidRequest = (message: string): NextResponse<ApiError> => NextResponse.json({
  error: { code: "VALIDATION_ERROR", message, retryable: false },
}, { status: 400 });

export async function POST(request: Request, context: { params: Promise<{ accountId: string }> }) {
  const params = accountIdParamsSchema.safeParse(await context.params);
  if (!params.success) {
    const invalid: ApiError = {
      error: { code: "INVALID_ACCOUNT_ID", message: "Dota 账号 ID 格式不正确。", retryable: false },
    };
    return NextResponse.json(invalid, { status: 400 });
  }

  let body: unknown;
  try {
    const text = await request.text();
    body = text.trim() === "" ? undefined : JSON.parse(text);
  } catch {
    return invalidRequest("请求需要有效的 JSON 同步触发类型。");
  }
  const syncRequest = playerSyncRequestSchema.safeParse(body);
  if (!syncRequest.success) {
    return invalidRequest("同步触发类型必须是 automatic 或 manual。");
  }

  try {
    const result = await fetchApi(
      syncJobResponseSchema,
      `/v1/players/${encodeURIComponent(params.data.accountId)}/sync`,
      {
        body: JSON.stringify({ trigger: syncRequest.data.trigger }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
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
