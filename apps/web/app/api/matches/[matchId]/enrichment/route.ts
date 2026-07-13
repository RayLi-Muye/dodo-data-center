import {
  matchDetailResponseSchema,
  matchIdParamsSchema,
  type ApiError,
} from "@dodo/contracts";
import { NextResponse } from "next/server";

import { DodoApiError, fetchApi } from "../../../../../lib/api";

export const preferredRegion = "hnd1";

export async function POST(
  _request: Request,
  context: { params: Promise<{ matchId: string }> },
) {
  const params = matchIdParamsSchema.safeParse(await context.params);
  if (!params.success) {
    const invalid: ApiError = {
      error: { code: "VALIDATION_ERROR", message: "比赛 ID 格式不正确。", retryable: false },
    };
    return NextResponse.json(invalid, { status: 400 });
  }

  try {
    const result = await fetchApi(
      matchDetailResponseSchema,
      `/v1/matches/${encodeURIComponent(params.data.matchId)}/enrichment`,
      { cache: "no-store", method: "POST" },
    );
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof DodoApiError && error.payload) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    const unavailable: ApiError = {
      error: {
        code: "SOURCE_UNAVAILABLE",
        message: "单场增强服务暂时无法连接，当前比赛数据仍会保留。",
        retryable: true,
      },
    };
    return NextResponse.json(unavailable, { status: 503 });
  }
}
