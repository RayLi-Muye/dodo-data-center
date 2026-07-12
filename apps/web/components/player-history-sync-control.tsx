"use client";

import type { PlayerHistorySync } from "@dodo/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatCount } from "../lib/format";
import {
  loadPlayerHistorySync,
  playerHistorySyncPresentation,
  PlayerHistorySyncRequestError,
  startAndPollPlayerHistorySync,
} from "../lib/player-history-sync";

export function PlayerHistorySyncControl({ accountId }: { accountId: string }) {
  const router = useRouter();
  const controllerRef = useRef<AbortController | null>(null);
  const [history, setHistory] = useState<PlayerHistorySync | null>(null);
  const [message, setMessage] = useState("正在读取历史导入状态…");
  const [tone, setTone] = useState<"positive" | "neutral" | "warning" | "danger">("neutral");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    void loadPlayerHistorySync(accountId, { signal: controller.signal })
      .then((state) => {
        const presentation = playerHistorySyncPresentation(state);
        setHistory(state);
        setMessage(presentation.message);
        setTone(presentation.tone);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setMessage(error instanceof PlayerHistorySyncRequestError
          ? error.message
          : "读取历史导入状态失败，请稍后重试。");
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
  }, [accountId]);

  const run = useCallback(async () => {
    if (controllerRef.current || history?.status === "complete") return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setMessage("正在导入下一批公开比赛历史…");
    setTone("neutral");
    try {
      const state = await startAndPollPlayerHistorySync(accountId, { signal: controller.signal });
      const presentation = playerHistorySyncPresentation(state);
      setHistory(state);
      setMessage(presentation.message);
      setTone(presentation.tone);
      router.refresh();
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessage(error instanceof PlayerHistorySyncRequestError
        ? error.message
        : "历史导入发生未预期错误，请稍后重试。");
      setTone("danger");
    } finally {
      setRunning(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [accountId, history?.status, router]);

  const disabled = loading || running || history?.status === "complete";

  return (
    <section className={`history-sync-control history-sync-control--${tone}`} aria-label="比赛历史导入">
      <div className="history-sync-control__heading">
        <strong>历史回填</strong>
        <span>{history?.status ?? (loading ? "loading" : "error")}</span>
      </div>
      <dl className="history-sync-control__metrics">
        <div><dt>已导入比赛</dt><dd>{history ? formatCount(history.matchesImported) : "—"}</dd></div>
        <div><dt>已导入批次</dt><dd>{history ? formatCount(history.pagesImported) : "—"}</dd></div>
        <div><dt>最早记录</dt><dd>{history?.oldestImportedAt ? history.oldestImportedAt.slice(0, 10) : "—"}</dd></div>
      </dl>
      <button disabled={disabled} onClick={() => void run()} type="button">
        {running ? "正在导入历史…" : "继续导入历史"}
      </button>
      <p aria-live="polite" role="status">{message}</p>
    </section>
  );
}
