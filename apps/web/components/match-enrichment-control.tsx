"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { EnrichmentRequestError, refreshMatchEnrichment } from "../lib/enrichment";
import { stratzEnrichmentPresentation } from "../lib/match-detail";

export function MatchEnrichmentControl({ matchId }: { matchId: string }) {
  const router = useRouter();
  const controllerRef = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("可手动重新获取该比赛的基础详情与可用增强字段。");
  const [tone, setTone] = useState<"neutral" | "positive" | "warning" | "danger">("neutral");

  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = async () => {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setMessage("正在刷新此比赛；当前页面数据会继续保留…");
    setTone("neutral");
    try {
      const match = await refreshMatchEnrichment(matchId, { signal: controller.signal });
      const presentation = stratzEnrichmentPresentation(match.stratzEnrichment);
      setMessage(presentation.detail);
      setTone(presentation.tone);
      router.refresh();
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessage(error instanceof EnrichmentRequestError
        ? error.message
        : "单场增强发生未预期错误，当前比赛数据仍会保留。");
      setTone("danger");
    } finally {
      setRunning(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  return (
    <div className={`match-enrichment-control match-enrichment-control--${tone}`}>
      <button disabled={running} onClick={() => void run()} type="button">
        {running ? "正在刷新比赛…" : "刷新此比赛增强"}
      </button>
      <p aria-live="polite" role="status">{message}</p>
    </div>
  );
}
