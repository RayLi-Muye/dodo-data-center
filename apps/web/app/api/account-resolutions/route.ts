import {
  accountReferenceSchema,
  accountResolutionResponseSchema,
  type ApiError,
} from "@dodo/contracts";
import { NextResponse } from "next/server";

import { DodoApiError, fetchApi } from "../../../lib/api";

const validationError = (message: string): ApiError => ({
  error: { code: "VALIDATION_ERROR", message, retryable: false },
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(validationError("请求需要有效的 JSON 账号引用。"), { status: 400 });
  }
  const reference = accountReferenceSchema.safeParse(body);
  if (!reference.success) {
    return NextResponse.json(validationError("账号引用格式不正确，请选择账号类型后重试。"), { status: 400 });
  }

  try {
    const result = await fetchApi(accountResolutionResponseSchema, "/v1/account-resolutions", {
      body: JSON.stringify(reference.data),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DodoApiError && error.payload) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    const unavailable: ApiError = {
      error: { code: "SOURCE_UNAVAILABLE", message: "账号服务暂时无法连接，请稍后重试。", retryable: true },
    };
    return NextResponse.json(unavailable, { status: 503 });
  }
}
