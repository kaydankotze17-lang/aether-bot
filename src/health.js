import http from "node:http";
import { config } from "./config.js";
import { logger } from "./logger.js";

export function startHealthServer(getStatus) {
  const server = http.createServer((req, res) => {
    const url = req.url?.split("?")[0] || "/";
    if (url === "/health" || url === "/" || url === "/ready") {
      const body = JSON.stringify({
        status: "ok",
        bot: getStatus(),
        uptime: Math.round(process.uptime()),
      });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  server.on("error", (error) => {
    logger.error("Health server error:", error);
  });

  server.listen(config.port, "0.0.0.0", () => {
    logger.info(`Health server listening on port ${config.port}`);
  });

  return server;
}
