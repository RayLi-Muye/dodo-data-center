import {
  apiErrorSchema,
  playerHistorySyncResponseSchema,
  type PlayerHistorySync,
} from "@dodo/contracts";

const REQUEST_TIMEOUT_MS = 8_000;
const OVERALL_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 75;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Wait = (milliseconds: number, signal: AbortSignal) => Promise<void>;

type HistorySyncOptions = {
  fetcher?: Fetcher;
  maxPollAttempts?: number;
  overallTimeoutMs?: number;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
  wait?: Wait;
};

export type HistorySyncPresentation = {
  message: string;
  tone: "positive" | "neutral" | "warning" | "danger";
};

export class PlayerHistorySyncRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlayerHistorySyncRequestError";
  }
}

const waitForDelay: Wait = (milliseconds, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });

const errorMessage = (code: string | undefined, fallback: string): string => {
  switch (code) {
    case "SOURCE_RATE_LIMITED":
      return "上游数据源正在限流，本轮历史导入未完成，请稍后继续。";
    case "SOURCE_UNAVAILABLE":
      return "上游数据源暂时不可用，已导入的历史记录仍会保留。";
    case "HISTORY_PRIVATE":
      return "该玩家关闭了公开比赛历史，Dodo 不会绕过隐私设置。";
    case "INTERNAL_ERROR":
      return "历史导入任务失败，请稍后重试。";
    default:
      return fallback;
  }
};

async function readHistorySync(response: Response): Promise<PlayerHistorySync> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PlayerHistorySyncRequestError("历史导入服务返回了无法读取的响应。");
  }
  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(body);
    throw new PlayerHistorySyncRequestError(
      parsedError.success
        ? errorMessage(parsedError.data.error.code, parsedError.data.error.message)
        : "历史导入服务暂时无法完成请求。",
    );
  }
  const parsed = playerHistorySyncResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new PlayerHistorySyncRequestError("历史导入服务返回了无法识别的数据。");
  }
  return parsed.data.data;
}

async function requestHistorySync(
  accountId: string,
  method: "GET" | "POST",
  signal: AbortSignal,
  fetcher: Fetcher,
  requestTimeoutMs: number,
): Promise<PlayerHistorySync> {
  const response = await fetcher(
    `/api/players/${encodeURIComponent(accountId)}/history-sync`,
    { method, signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]) },
  );
  return readHistorySync(response);
}

const runWithSignals = async (
  accountId: string,
  method: "GET" | "POST",
  options: HistorySyncOptions,
): Promise<PlayerHistorySync> => {
  if (options.signal?.aborted) throw options.signal.reason;
  const fetcher = options.fetcher ?? fetch;
  const timeoutSignal = AbortSignal.timeout(options.overallTimeoutMs ?? OVERALL_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  try {
    return await requestHistorySync(
      accountId,
      method,
      signal,
      fetcher,
      options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof PlayerHistorySyncRequestError || options.signal?.aborted) throw error;
    if (timeoutSignal.aborted || (error instanceof Error && error.name === "TimeoutError")) {
      throw new PlayerHistorySyncRequestError("历史导入请求超时，请稍后重试。");
    }
    throw new PlayerHistorySyncRequestError("无法连接历史导入服务，请检查网络后重试。");
  }
};

export const loadPlayerHistorySync = (
  accountId: string,
  options: HistorySyncOptions = {},
): Promise<PlayerHistorySync> => runWithSignals(accountId, "GET", options);

export async function startAndPollPlayerHistorySync(
  accountId: string,
  options: HistorySyncOptions = {},
): Promise<PlayerHistorySync> {
  const fetcher = options.fetcher ?? fetch;
  const wait = options.wait ?? waitForDelay;
  const timeoutSignal = AbortSignal.timeout(options.overallTimeoutMs ?? OVERALL_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  try {
    let state = await requestHistorySync(accountId, "POST", signal, fetcher, requestTimeoutMs);
    if (state.status !== "syncing") return state;
    const maxPollAttempts = options.maxPollAttempts ?? MAX_POLL_ATTEMPTS;
    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      await wait(options.pollIntervalMs ?? POLL_INTERVAL_MS, signal);
      state = await requestHistorySync(accountId, "GET", signal, fetcher, requestTimeoutMs);
      if (state.status !== "syncing") return state;
    }
    throw new PlayerHistorySyncRequestError("历史导入等待超过轮询上限，请稍后重试。");
  } catch (error) {
    if (error instanceof PlayerHistorySyncRequestError || options.signal?.aborted) throw error;
    if (timeoutSignal.aborted || (error instanceof Error && error.name === "TimeoutError")) {
      throw new PlayerHistorySyncRequestError("历史导入请求超时，请稍后重试。");
    }
    throw new PlayerHistorySyncRequestError("无法连接历史导入服务，请检查网络后重试。");
  }
}

export function playerHistorySyncPresentation(
  state: PlayerHistorySync,
): HistorySyncPresentation {
  switch (state.status) {
    case "idle":
      return { message: "尚未开始导入更早的公开比赛。", tone: "neutral" };
    case "syncing":
      return { message: "正在导入下一批公开比赛历史…", tone: "neutral" };
    case "partial":
      return { message: "本批历史已部分导入，可稍后继续。", tone: "warning" };
    case "complete":
      return { message: "已到达公开比赛历史末端。", tone: "positive" };
    case "source_rate_limited":
      return { message: errorMessage(state.errorCode ?? "SOURCE_RATE_LIMITED", "历史导入被限流。"), tone: "warning" };
    case "source_unavailable":
      return { message: errorMessage(state.errorCode ?? "SOURCE_UNAVAILABLE", "历史数据源不可用。"), tone: "danger" };
    case "failed":
      return { message: errorMessage(state.errorCode ?? "INTERNAL_ERROR", "历史导入失败。"), tone: "danger" };
  }
}
