import {
  apiErrorSchema,
  matchDetailResponseSchema,
  playerEnrichmentProgressResponseSchema,
  type MatchDetail,
  type MatchEnrichmentScope,
  type PlayerEnrichmentProgress,
} from "@dodo/contracts";

const REQUEST_TIMEOUT_MS = 10_000;
const OVERALL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 45;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Wait = (milliseconds: number, signal: AbortSignal) => Promise<void>;

type RequestOptions = {
  fetcher?: Fetcher;
  maxPollAttempts?: number;
  overallTimeoutMs?: number;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
  wait?: Wait;
};

export class EnrichmentRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnrichmentRequestError";
  }
}

export type PlayerEnrichmentControlPresentation = {
  buttonLabel: string;
  disabled: boolean;
  message: string;
  tone: "neutral" | "positive" | "warning";
};

export const playerEnrichmentControlPresentation = (
  progress: PlayerEnrichmentProgress,
  phase: "loaded" | "batch_finished",
): PlayerEnrichmentControlPresentation => {
  const actionable = progress.retryEligibleCount > 0 || progress.notRequestedCount > 0;
  if (actionable) {
    const remaining = `${progress.retryEligibleCount.toLocaleString("zh-CN")} 场当前可处理，${progress.notRequestedCount.toLocaleString("zh-CN")} 场尚未请求`;
    return {
      buttonLabel: "继续下一批",
      disabled: false,
      message: phase === "batch_finished"
        ? `本批已结束，仍有 ${remaining}；需要时可继续下一批。`
        : `当前范围仍有 ${remaining}；每次只运行下一批。`,
      tone: phase === "batch_finished" ? "warning" : "neutral",
    };
  }
  if (progress.retryScheduledCount > 0) {
    return {
      buttonLabel: "等待计划重试",
      disabled: true,
      message: `${progress.retryScheduledCount.toLocaleString("zh-CN")} 场已计划重试，尚未到再次请求时间。`,
      tone: "warning",
    };
  }
  if (progress.providerBlockedCount > 0) {
    return {
      buttonLabel: "提供方暂不可用",
      disabled: true,
      message: `${progress.providerBlockedCount.toLocaleString("zh-CN")} 场受提供方阻断，当前不能再次请求；已有比赛数据仍会保留。`,
      tone: "warning",
    };
  }
  if (progress.totalMatches === 0) {
    return {
      buttonLabel: "当前范围为空",
      disabled: true,
      message: "当前范围没有已导入比赛。",
      tone: "neutral",
    };
  }
  if (progress.terminalPartialCount > 0 || progress.terminalFailedCount > 0) {
    return {
      buttonLabel: "当前范围已结算",
      disabled: true,
      message: `当前范围已无可自动处理比赛：${progress.completeCount.toLocaleString("zh-CN")} 场完整增强，${progress.terminalPartialCount.toLocaleString("zh-CN")} 场终止部分可用，${progress.terminalFailedCount.toLocaleString("zh-CN")} 场终止失败。`,
      tone: "warning",
    };
  }
  if (progress.completeCount === progress.totalMatches) {
    return {
      buttonLabel: "当前范围已完成",
      disabled: true,
      message: `当前范围 ${progress.completeCount.toLocaleString("zh-CN")} 场比赛均已完成增强。`,
      tone: "positive",
    };
  }
  return {
    buttonLabel: "暂无可运行批次",
    disabled: true,
    message: "当前范围目前没有可启动的增强批次；已有比赛数据仍会保留。",
    tone: "neutral",
  };
};

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

const safeErrorMessage = (code: string | undefined, fallback: string): string => {
  switch (code) {
    case "SOURCE_RATE_LIMITED":
      return "STRATZ 正在限流，本批未完成；已有比赛数据仍会保留。";
    case "SOURCE_UNAVAILABLE":
      return "增强服务暂时不可用，已有比赛数据仍会保留。";
    case "NOT_FOUND":
      return "没有找到可增强的比赛记录。";
    case "VALIDATION_ERROR":
      return "增强请求参数无效。";
    default:
      return fallback;
  }
};

const requestSignal = (
  signal: AbortSignal,
  requestTimeoutMs: number,
): AbortSignal => AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]);

async function readProgress(response: Response): Promise<PlayerEnrichmentProgress> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new EnrichmentRequestError("增强服务返回了无法读取的响应。");
  }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new EnrichmentRequestError(parsed.success
      ? safeErrorMessage(parsed.data.error.code, "本批增强请求未完成，请稍后重试。")
      : "增强服务暂时无法完成请求。");
  }
  const parsed = playerEnrichmentProgressResponseSchema.safeParse(body);
  if (!parsed.success) throw new EnrichmentRequestError("增强进度返回了无法识别的数据。");
  return parsed.data.data;
}

async function requestProgress(
  accountId: string,
  scope: MatchEnrichmentScope,
  method: "GET" | "POST",
  signal: AbortSignal,
  fetcher: Fetcher,
  requestTimeoutMs: number,
): Promise<PlayerEnrichmentProgress> {
  const response = await fetcher(
    `/api/players/${encodeURIComponent(accountId)}/enrichment?scope=${scope}`,
    { method, signal: requestSignal(signal, requestTimeoutMs) },
  );
  return readProgress(response);
}

const runWithSignals = async <T>(
  options: RequestOptions,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  if (options.signal?.aborted) throw options.signal.reason;
  const timeoutSignal = AbortSignal.timeout(options.overallTimeoutMs ?? OVERALL_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  try {
    return await operation(signal);
  } catch (error) {
    if (error instanceof EnrichmentRequestError || options.signal?.aborted) throw error;
    if (timeoutSignal.aborted || (error instanceof Error && error.name === "TimeoutError")) {
      throw new EnrichmentRequestError("增强请求超时，请稍后重试。");
    }
    throw new EnrichmentRequestError("无法连接增强服务，请检查网络后重试。");
  }
};

export const loadPlayerEnrichment = (
  accountId: string,
  scope: MatchEnrichmentScope,
  options: RequestOptions = {},
): Promise<PlayerEnrichmentProgress> => runWithSignals(options, (signal) => requestProgress(
  accountId,
  scope,
  "GET",
  signal,
  options.fetcher ?? fetch,
  options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
));

export async function startAndPollPlayerEnrichment(
  accountId: string,
  scope: MatchEnrichmentScope,
  options: RequestOptions = {},
): Promise<PlayerEnrichmentProgress> {
  return runWithSignals(options, async (signal) => {
    const fetcher = options.fetcher ?? fetch;
    const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    let progress = await requestProgress(accountId, scope, "POST", signal, fetcher, requestTimeoutMs);
    const wait = options.wait ?? waitForDelay;
    const maxPollAttempts = options.maxPollAttempts ?? MAX_POLL_ATTEMPTS;
    for (let attempt = 0; progress.running && attempt < maxPollAttempts; attempt += 1) {
      await wait(options.pollIntervalMs ?? POLL_INTERVAL_MS, signal);
      progress = await requestProgress(accountId, scope, "GET", signal, fetcher, requestTimeoutMs);
    }
    if (progress.running) {
      throw new EnrichmentRequestError("本批增强等待超过轮询上限，请稍后读取最新状态。");
    }
    return progress;
  });
}

export async function pollPlayerEnrichment(
  accountId: string,
  scope: MatchEnrichmentScope,
  initial: PlayerEnrichmentProgress,
  options: RequestOptions = {},
): Promise<PlayerEnrichmentProgress> {
  if (!initial.running) return initial;
  return runWithSignals(options, async (signal) => {
    const fetcher = options.fetcher ?? fetch;
    const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    const wait = options.wait ?? waitForDelay;
    const maxPollAttempts = options.maxPollAttempts ?? MAX_POLL_ATTEMPTS;
    let progress = initial;
    for (let attempt = 0; progress.running && attempt < maxPollAttempts; attempt += 1) {
      await wait(options.pollIntervalMs ?? POLL_INTERVAL_MS, signal);
      progress = await requestProgress(accountId, scope, "GET", signal, fetcher, requestTimeoutMs);
    }
    if (progress.running) {
      throw new EnrichmentRequestError("本批增强等待超过轮询上限，请稍后读取最新状态。");
    }
    return progress;
  });
}

export async function refreshMatchEnrichment(
  matchId: string,
  options: RequestOptions = {},
): Promise<MatchDetail> {
  return runWithSignals(options, async (signal) => {
    const response = await (options.fetcher ?? fetch)(
      `/api/matches/${encodeURIComponent(matchId)}/enrichment`,
      {
        method: "POST",
        signal: requestSignal(signal, options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS),
      },
    );
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new EnrichmentRequestError("单场增强服务返回了无法读取的响应。");
    }
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(body);
      throw new EnrichmentRequestError(parsed.success
        ? safeErrorMessage(parsed.data.error.code, "单场增强未完成，当前比赛数据仍会保留。")
        : "单场增强服务暂时无法完成请求。");
    }
    const parsed = matchDetailResponseSchema.safeParse(body);
    if (!parsed.success) throw new EnrichmentRequestError("单场增强返回了无法识别的数据。");
    return parsed.data.data;
  });
}
