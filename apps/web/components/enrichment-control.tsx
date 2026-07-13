"use client";

import type { MatchEnrichmentScope, PlayerEnrichmentProgress } from "@dodo/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  EnrichmentRequestError,
  loadPlayerEnrichment,
  playerEnrichmentControlPresentation,
  pollPlayerEnrichment,
  startAndPollPlayerEnrichment,
} from "../lib/enrichment";
import { formatCount, formatPercent } from "../lib/format";

const scopeLabels: Record<MatchEnrichmentScope, string> = {
  recent: "最近 20 场",
  all_imported: "全部已导入",
};

export function EnrichmentControl({ accountId }: { accountId: string }) {
  const router = useRouter();
  const controllerRef = useRef<AbortController | null>(null);
  const [scope, setScope] = useState<MatchEnrichmentScope>("recent");
  const [progress, setProgress] = useState<PlayerEnrichmentProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("正在读取增强进度…");
  const [tone, setTone] = useState<"neutral" | "positive" | "warning" | "danger">("neutral");

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setProgress(null);
    setMessage(`正在读取${scopeLabels[scope]}增强进度…`);
    setTone("neutral");
    void loadPlayerEnrichment(accountId, scope, { signal: controller.signal })
      .then((initial) => pollPlayerEnrichment(accountId, scope, initial, { signal: controller.signal }))
      .then((next) => {
        setProgress(next);
        const presentation = playerEnrichmentControlPresentation(next, "loaded");
        setMessage(presentation.message);
        setTone(presentation.tone);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setMessage(error instanceof EnrichmentRequestError
          ? error.message
          : "读取增强进度失败，请稍后重试。");
        setTone("danger");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
        if (controllerRef.current === controller) controllerRef.current = null;
      });
    return () => {
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [accountId, scope]);

  const run = useCallback(async () => {
    if (controllerRef.current || running) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setMessage(`正在处理${scopeLabels[scope]}中的下一批（最多 20 场）…`);
    setTone("neutral");
    try {
      const next = await startAndPollPlayerEnrichment(accountId, scope, {
        signal: controller.signal,
      });
      setProgress(next);
      const presentation = playerEnrichmentControlPresentation(next, "batch_finished");
      setMessage(presentation.message);
      setTone(presentation.tone);
      router.refresh();
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessage(error instanceof EnrichmentRequestError
        ? error.message
        : "本批增强发生未预期错误，已有比赛数据仍会保留。");
      setTone("danger");
    } finally {
      setRunning(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [accountId, router, running, scope]);

  const presentation = progress
    ? playerEnrichmentControlPresentation(progress, "loaded")
    : null;
  const coverageRate = progress
    ? progress.totalMatches === 0 ? 1 : progress.completeCount / progress.totalMatches
    : null;
  const disabled = loading || running || progress?.running === true || presentation?.disabled === true;

  return (
    <section className={`enrichment-control enrichment-control--${tone}`} aria-label="比赛数据增强">
      <header>
        <div>
          <small>STRATZ BATCH ENRICHMENT</small>
          <h2>比赛增强进度</h2>
        </div>
        <div className="enrichment-control__scope" aria-label="增强范围" role="group">
          {(Object.keys(scopeLabels) as MatchEnrichmentScope[]).map((item) => (
            <button
              aria-pressed={scope === item}
              disabled={running}
              key={item}
              onClick={() => setScope(item)}
              type="button"
            >
              {scopeLabels[item]}
            </button>
          ))}
        </div>
      </header>
      <dl className="enrichment-control__metrics">
        <div><dt>范围比赛</dt><dd>{progress ? formatCount(progress.totalMatches) : "—"}</dd></div>
        <div><dt>详情就绪</dt><dd>{progress ? formatCount(progress.detailReadyCount) : "—"}</dd></div>
        <div><dt>完整增强</dt><dd>{progress ? formatCount(progress.completeCount) : "—"}</dd></div>
        <div><dt>等待重试</dt><dd>{progress ? formatCount(progress.retryScheduledCount) : "—"}</dd></div>
        <div><dt>终止部分</dt><dd>{progress ? formatCount(progress.terminalPartialCount) : "—"}</dd></div>
        <div><dt>终止失败</dt><dd>{progress ? formatCount(progress.terminalFailedCount) : "—"}</dd></div>
        <div><dt>提供方阻断</dt><dd>{progress ? formatCount(progress.providerBlockedCount) : "—"}</dd></div>
        <div><dt>尚未请求</dt><dd>{progress ? formatCount(progress.notRequestedCount) : "—"}</dd></div>
      </dl>
      <div className="enrichment-control__footer">
        <span>完整增强覆盖 {formatPercent(coverageRate)}</span>
        <button disabled={disabled} onClick={() => void run()} type="button">
          {running ? "正在运行本批…" : presentation?.buttonLabel ?? "启动下一批"}
        </button>
      </div>
      <p aria-live="polite" role="status">{message}</p>
      <small className="enrichment-control__note">全部已导入只表示本系统已有的公开比赛；前端不会自动连续扫描全历史。</small>
    </section>
  );
}
