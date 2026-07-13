import {
  accountIdParamsSchema,
  playerMatchesQuerySchema,
  playerMatchesResponseSchema,
  type ApiError,
} from "@dodo/contracts";
import { NextResponse } from "next/server";

import { DodoApiError, fetchApi } from "../../../../../lib/api";

export const preferredRegion = "hnd1";

const invalidRequest = (message: string): NextResponse<ApiError> => NextResponse.json({
  error: { code: "VALIDATION_ERROR", message, retryable: false },
}, { status: 400 });

export async function GET(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const params = accountIdParamsSchema.safeParse(await context.params);
  if (!params.success) return invalidRequest("Dota 账号 ID 格式不正确。");

  const url = new URL(request.url);
  const query = playerMatchesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success) return invalidRequest("比赛筛选条件格式不正确。");

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query.data)) {
    if (value !== undefined) search.set(key, String(value));
  }

  try {
    const result = await fetchApi(
      playerMatchesResponseSchema,
      `/v1/players/${encodeURIComponent(params.data.accountId)}/matches?${search.toString()}`,
      { cache: "no-store" },
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DodoApiError && error.payload) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    const unavailable: ApiError = {
      error: {
        code: "SOURCE_UNAVAILABLE",
        message: "比赛数据服务暂时无法连接，请稍后重试。",
        retryable: true,
      },
    };
    return NextResponse.json(unavailable, { status: 503 });
  }
}
