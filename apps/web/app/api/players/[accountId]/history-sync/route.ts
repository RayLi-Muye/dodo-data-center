import {
  accountIdParamsSchema,
  playerHistorySyncResponseSchema,
  type ApiError,
} from "@dodo/contracts";
import { NextResponse } from "next/server";

import { DodoApiError, fetchApi } from "../../../../../lib/api";

export const preferredRegion = "hnd1";

const invalidAccount = (): NextResponse<ApiError> => NextResponse.json({
  error: { code: "INVALID_ACCOUNT_ID", message: "Dota 账号 ID 格式不正确。", retryable: false },
}, { status: 400 });

const proxyHistorySync = async (accountId: string, method: "GET" | "POST") => {
  try {
    const result = await fetchApi(
      playerHistorySyncResponseSchema,
      `/v1/players/${encodeURIComponent(accountId)}/history-sync`,
      { cache: "no-store", method },
    );
    return NextResponse.json(result, { status: method === "POST" ? 202 : 200 });
  } catch (error) {
    if (error instanceof DodoApiError && error.payload) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    const unavailable: ApiError = {
      error: {
        code: "SOURCE_UNAVAILABLE",
        message: "历史导入服务暂时无法连接，请稍后重试。",
        retryable: true,
      },
    };
    return NextResponse.json(unavailable, { status: 503 });
  }
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const params = accountIdParamsSchema.safeParse(await context.params);
  if (!params.success) return invalidAccount();
  return proxyHistorySync(params.data.accountId, "GET");
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const params = accountIdParamsSchema.safeParse(await context.params);
  if (!params.success) return invalidAccount();
  return proxyHistorySync(params.data.accountId, "POST");
}
