import { createSeedRepository } from "@dodo/db";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("deployment health", () => {
  it("keeps liveness independent from repository readiness", async () => {
    const repository = await createSeedRepository();
    repository.getLatestMatchAt = async () => {
      throw new Error("database credential must not leak");
    };
    const app = await buildApp({ dataMode: "seed", repository });
    apps.push(app);

    const live = await app.inject({ method: "GET", url: "/health/live" });
    const ready = await app.inject({ method: "GET", url: "/health/ready" });

    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: "ok" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: "not_ready" });
    expect(ready.body).not.toContain("credential");
  });

  it("reports readiness after a repository query succeeds", async () => {
    const app = await buildApp({ dataMode: "seed" });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready" });
  });
});
