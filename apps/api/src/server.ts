import { buildApp } from "./app.js";
import { installShutdownHandlers } from "./shutdown.js";

const parsePort = (value: string | undefined): number => {
  const port = Number(value ?? 3001);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 3001;
};

let app: Awaited<ReturnType<typeof buildApp>> | undefined;

try {
  app = await buildApp({ logger: true });
  await app.listen({
    host: process.env.API_HOST ?? process.env.HOST ?? "127.0.0.1",
    port: parsePort(process.env.API_PORT ?? process.env.PORT),
  });
  installShutdownHandlers(app);
} catch (error) {
  if (app) {
    app.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "API failed to start",
    );
    await app.close();
  } else {
    console.error("API failed to start");
  }
  process.exitCode = 1;
}
