type ClosableApp = {
  close(): Promise<void>;
  log: {
    error(bindings: { errorName: string }, message: string): void;
  };
};

type Signal = "SIGINT" | "SIGTERM";

export type SignalProcess = {
  exitCode: string | number | null | undefined;
  on(signal: Signal, listener: () => void): unknown;
  off(signal: Signal, listener: () => void): unknown;
};

export const installShutdownHandlers = (
  app: ClosableApp,
  processLike: SignalProcess = process,
) => {
  let closing: Promise<void> | undefined;

  const shutdown = (): Promise<void> => {
    closing ??= app.close().catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "API failed to shut down cleanly",
      );
      processLike.exitCode = 1;
    });
    return closing;
  };

  const onSignal = () => {
    void shutdown();
  };
  processLike.on("SIGINT", onSignal);
  processLike.on("SIGTERM", onSignal);

  return {
    shutdown,
    dispose: () => {
      processLike.off("SIGINT", onSignal);
      processLike.off("SIGTERM", onSignal);
    },
  };
};
