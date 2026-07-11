"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  PlayerSyncRequestError,
  playerSyncPresentation,
  playerSyncProgressMessage,
  shouldStartPlayerSync,
  startAndPollPlayerSync,
  type PlayerSyncPresentation,
} from "../lib/player-sync";

type ControlState = PlayerSyncPresentation & { running: boolean };

const idleState: ControlState = {
  message: "数据超过 15 分钟会自动更新，也可立即刷新。",
  running: false,
  successful: false,
  tone: "neutral",
};

export function PlayerSyncControl({
  accountId,
  autoSync = false,
  updatedAt,
}: {
  accountId: string;
  autoSync?: boolean;
  updatedAt?: string;
}) {
  const router = useRouter();
  const controllerRef = useRef<AbortController | null>(null);
  const autoStartedRef = useRef(false);
  const [state, setState] = useState<ControlState>(idleState);

  const run = useCallback(async (force: boolean) => {
    if (!shouldStartPlayerSync(updatedAt, force) || controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ message: "正在启动公开比赛同步…", running: true, successful: false, tone: "neutral" });
    try {
      const job = await startAndPollPlayerSync(accountId, {
        onProgress: (progress) => setState({
          message: playerSyncProgressMessage(progress),
          running: true,
          successful: false,
          tone: "neutral",
        }),
        signal: controller.signal,
      });
      const presentation = playerSyncPresentation(job.status);
      setState({ ...presentation, running: false });
      if (presentation.successful) router.refresh();
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        message: error instanceof PlayerSyncRequestError ? error.message : "同步任务发生未预期错误，请稍后重试。",
        running: false,
        successful: false,
        tone: "danger",
      });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [accountId, router, updatedAt]);

  useEffect(() => {
    if (!autoStartedRef.current && (autoSync || shouldStartPlayerSync(updatedAt))) {
      autoStartedRef.current = true;
      void run(false);
    }
  }, [autoSync, run, updatedAt]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return (
    <div className={`player-sync-control player-sync-control--${state.tone}`}>
      <button disabled={state.running} onClick={() => void run(true)} type="button">
        {state.running ? "正在刷新数据…" : "刷新数据"}
      </button>
      <p aria-live="polite" role="status">{state.message}</p>
    </div>
  );
}
