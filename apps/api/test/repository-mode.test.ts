import { createLiveRepository } from "@dodo/db";
import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { parseRepositoryMode } from "../src/repository-mode.js";

describe("repository selection", () => {
  it("defaults to memory and rejects unsupported modes", () => {
    expect(parseRepositoryMode(undefined)).toBe("memory");
    expect(parseRepositoryMode("memory")).toBe("memory");
    expect(parseRepositoryMode("postgres")).toBe("postgres");
    expect(() => parseRepositoryMode("other")).toThrow(
      "DODO_REPOSITORY must be either memory or postgres",
    );
  });

  it("fails startup without exposing credentials when postgres has no database URL", async () => {
    await expect(
      buildApp({
        environment: "test",
        dataMode: "live",
        repositoryMode: "postgres",
        databaseUrl: "",
      }),
    ).rejects.toThrow("DATABASE_URL is required when DODO_REPOSITORY=postgres");
  });

  it("closes an injected repository with the Fastify lifecycle", async () => {
    const repository = await createLiveRepository();
    const close = vi.spyOn(repository, "close");
    const app = await buildApp({ environment: "test", dataMode: "seed", repository });

    await app.close();

    expect(close).toHaveBeenCalledOnce();
  });
});
