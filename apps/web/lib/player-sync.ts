import { apiErrorSchema, syncJobResponseSchema, type SyncJob } from "@dodo/contracts";

export const PLAYER_SYNC_FRESHNESS_MS = 30 * 60 * 1_000;

const REQUEST_TIMEOUT_MS = 8_000;
const OVERALL_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 75;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Wait = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export type PlayerSyncProgress =
  | { phase: "starting" }
  | { attempt: number; maxAttempts: number; phase: "polling" };

export type PlayerSyncPresentation = {
  message: string;
  successful: boolean;
  tone: "positive" | "neutral" | "warning" | "danger";
};

type RunPlayerSyncOptions = {
  fetcher?: Fetcher;
  maxPollAttempts?: number;
  onProgress?: (progress: PlayerSyncProgress) => void;
  overallTimeoutMs?: number;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
  trigger?: "automatic" | "manual";
  wait?: Wait;
};

export class PlayerSyncRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlayerSyncRequestError";
  }
}

const waitForDelay: Wait = (milliseconds, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });

const requestMessage = (code: string | undefined, fallback: string): string => {
  switch (code) {
    case "HISTORY_PRIVATE":
      return "该玩家关闭了公开比赛历史，Dodo 不会绕过隐私设置。";
    case "PROFILE_PRIVATE":
      return "该玩家的 Steam 资料未公开，暂时无法同步账号数据。";
    case "SOURCE_RATE_LIMITED":
      return "上游数据源正在限流，请稍后再刷新。";
    case "SOURCE_UNAVAILABLE":
      return "上游数据源暂时不可用，请稍后再刷新。";
    case "PARSE_PENDING":
      return "比赛仍在等待解析，暂时不足以生成可信统计。";
    case "NOT_FOUND":
      return "未找到对应的公开账号记录，请确认账号 ID。";
    case "INTERNAL_ERROR":
      return "同步任务执行失败，请稍后重试。";
    default:
      return fallback;
  }
};

async function readSyncJob(response: Response): Promise<SyncJob> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PlayerSyncRequestError("同步服务返回了无法读取的响应。请稍后重试。");
  }
  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(body);
    throw new PlayerSyncRequestError(
      parsedError.success
        ? requestMessage(parsedError.data.error.code, parsedError.data.error.message)
        : "同步服务暂时无法完成请求，请稍后重试。",
    );
  }
  const parsed = syncJobResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new PlayerSyncRequestError("同步服务返回了无法识别的数据。请稍后重试。");
  }
  return parsed.data.data;
}

async function requestJob(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  fetcher: Fetcher,
  timeoutMs: number,
): Promise<SyncJob> {
  const response = await fetcher(url, {
    ...init,
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });
  return readSyncJob(response);
}

export function shouldStartPlayerSync(
  updatedAt: string | null | undefined,
  force = false,
  now = Date.now(),
): boolean {
  if (force) return true;
  if (!updatedAt) return true;
  const updatedAtMs = Date.parse(updatedAt);
  return !Number.isFinite(updatedAtMs) || now - updatedAtMs >= PLAYER_SYNC_FRESHNESS_MS;
}

export function playerSyncProgressMessage(progress: PlayerSyncProgress): string {
  return progress.phase === "starting"
    ? "正在启动公开比赛同步…"
    : `正在同步公开比赛…（${progress.attempt}/${progress.maxAttempts}）`;
}

export function playerSyncPresentation(status: SyncJob["status"]): PlayerSyncPresentation {
  switch (status) {
    case "public_complete":
      return { message: "公开比赛数据已更新。", successful: true, tone: "positive" };
    case "public_partial":
      return { message: "公开比赛已部分更新；页面会继续标记数据完整度。", successful: true, tone: "warning" };
    case "history_private":
      return { message: "该玩家关闭了公开比赛历史，Dodo 不会绕过隐私设置。", successful: false, tone: "warning" };
    case "profile_private":
      return { message: "该玩家的 Steam 资料未公开，暂时无法同步账号数据。", successful: false, tone: "warning" };
    case "source_rate_limited":
      return { message: "上游数据源正在限流，请稍后再刷新。", successful: false, tone: "warning" };
    case "source_unavailable":
      return { message: "上游数据源暂时不可用，现有数据不会被当作完整结果。", successful: false, tone: "danger" };
    case "parse_pending":
      return { message: "比赛仍在等待解析，暂时不足以生成可信统计。", successful: false, tone: "neutral" };
    case "not_found":
      return { message: "未找到对应的公开账号记录，请确认账号 ID。", successful: false, tone: "warning" };
    case "failed":
      return { message: "同步任务执行失败，请稍后重试。", successful: false, tone: "danger" };
    case "syncing":
      return { message: "正在同步公开比赛…", successful: false, tone: "neutral" };
  }
}

export async function startAndPollPlayerSync(
  accountId: string,
  options: RunPlayerSyncOptions = {},
): Promise<SyncJob> {
  if (options.signal?.aborted) throw options.signal.reason;

  const fetcher = options.fetcher ?? fetch;
  const maxPollAttempts = options.maxPollAttempts ?? MAX_POLL_ATTEMPTS;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const wait = options.wait ?? waitForDelay;
  const timeoutSignal = AbortSignal.timeout(options.overallTimeoutMs ?? OVERALL_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

  try {
    options.onProgress?.({ phase: "starting" });
    let job = await requestJob(
      `/api/players/${encodeURIComponent(accountId)}/sync`,
      {
        body: JSON.stringify({ trigger: options.trigger ?? "manual" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
      signal,
      fetcher,
      requestTimeoutMs,
    );
    if (job.status !== "syncing") return job;

    for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
      options.onProgress?.({ attempt, maxAttempts: maxPollAttempts, phase: "polling" });
      await wait(pollIntervalMs, signal);
      job = await requestJob(
        `/api/sync-jobs/${encodeURIComponent(job.jobId)}`,
        { method: "GET" },
        signal,
        fetcher,
        requestTimeoutMs,
      );
      if (job.status !== "syncing") return job;
    }
    throw new PlayerSyncRequestError("同步等待超过轮询上限，请稍后重新刷新。");
  } catch (error) {
    if (error instanceof PlayerSyncRequestError || options.signal?.aborted) throw error;
    if (timeoutSignal.aborted || (error instanceof Error && error.name === "TimeoutError")) {
      throw new PlayerSyncRequestError("同步请求超时，请稍后重新刷新。");
    }
    throw new PlayerSyncRequestError("无法连接同步服务，请检查网络后重试。");
  }
}
