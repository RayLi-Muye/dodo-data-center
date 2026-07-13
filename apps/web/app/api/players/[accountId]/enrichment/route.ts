import {
  accountIdParamsSchema,
  playerEnrichmentProgressResponseSchema,
  playerEnrichmentQuerySchema,
  type ApiError,
} from "@dodo/contracts";
import { NextResponse } from "next/server";

import { DodoApiError, fetchApi } from "../../../../../lib/api";

export const preferredRegion = "hnd1";

const invalid = (code: ApiError["error"]["code"], message: string): NextResponse<ApiError> => NextResponse.json({
  error: { code, message, retryable: false },
}, { status: 400 });

const proxyEnrichment = async (
  request: Request,
  context: { params: Promise<{ accountId: string }> },
  method: "GET" | "POST",
) => {
  const params = accountIdParamsSchema.safeParse(await context.params);
  if (!params.success) return invalid("INVALID_ACCOUNT_ID", "Dota 账号 ID 格式不正确。");
  const requestedScope = new URL(request.url).searchParams.get("scope") ?? undefined;
  const query = playerEnrichmentQuerySchema.safeParse({ scope: requestedScope });
  if (!query.success) return invalid("VALIDATION_ERROR", "增强范围必须是 recent 或 all_imported。");

  try {
    const result = await fetchApi(
      playerEnrichmentProgressResponseSchema,
      `/v1/players/${encodeURIComponent(params.data.accountId)}/enrichment?scope=${query.data.scope}`,
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
        message: "比赛增强服务暂时无法连接，已有比赛数据不会被清空。",
        retryable: true,
      },
    };
    return NextResponse.json(unavailable, { status: 503 });
  }
};

export const GET = (
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) => proxyEnrichment(request, context, "GET");

export const POST = (
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) => proxyEnrichment(request, context, "POST");
