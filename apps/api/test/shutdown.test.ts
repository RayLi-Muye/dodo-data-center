import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { installShutdownHandlers, type SignalProcess } from "../src/shutdown.js";

class FakeProcess extends EventEmitter implements SignalProcess {
  exitCode: string | number | null | undefined;
}

describe("shutdown lifecycle", () => {
  it("closes the app only once across repeated signals", async () => {
    const processLike = new FakeProcess();
    const close = vi.fn(async () => undefined);
    const app = {
      close,
      log: { error: vi.fn() },
    };
    const controller = installShutdownHandlers(app, processLike);

    processLike.emit("SIGTERM");
    processLike.emit("SIGINT");
    await controller.shutdown();

    expect(close).toHaveBeenCalledTimes(1);
    expect(processLike.exitCode).toBeUndefined();
    controller.dispose();
    expect(processLike.listenerCount("SIGTERM")).toBe(0);
    expect(processLike.listenerCount("SIGINT")).toBe(0);
  });

  it("sets a failing exit code without logging the error message", async () => {
    const processLike = new FakeProcess();
    const error = vi.fn();
    const controller = installShutdownHandlers(
      {
        close: async () => {
          throw new Error("secret connection string");
        },
        log: { error },
      },
      processLike,
    );

    await controller.shutdown();

    expect(processLike.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(
      { errorName: "Error" },
      "API failed to shut down cleanly",
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain("connection string");
    controller.dispose();
  });
});
