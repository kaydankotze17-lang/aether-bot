import { existsSync } from "node:fs";
import ffmpegStatic from "ffmpeg-static";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { startHealthServer } from "./health.js";
import { startDashboardServer } from "./dashboard.js";
import { playerManager } from "./player/PlayerManager.js";
import * as ready from "./events/ready.js";
import * as interactionCreate from "./events/interactionCreate.js";
import * as voiceStateUpdate from "./events/voiceStateUpdate.js";

if (ffmpegStatic && existsSync(ffmpegStatic)) {
  process.env.FFMPEG_PATH = ffmpegStatic;
  process.env.FFMPEG_BIN = ffmpegStatic;
}

async function assertDavey() {
  try {
    await import("@snazzah/davey");
    logger.info("DAVE voice encryption library loaded.");
  } catch (error) {
    logger.error(
      "Could not load @snazzah/davey. Discord will reject voice connections with close code 4017.",
      error,
    );
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const ctx = { client, playerManager };

client.once(Events.ClientReady, (...args) => ready.execute(...args, ctx));
client.on(Events.InteractionCreate, (...args) => interactionCreate.execute(...args, ctx));
client.on(Events.VoiceStateUpdate, (...args) => voiceStateUpdate.execute(...args, ctx));

client.on("error", (error) => logger.error("Discord client error:", error));
client.on("shardError", (error) => logger.error("Shard error:", error));
client.on("warn", (message) => logger.warn(message));

process.on("unhandledRejection", (error) => {
  logger.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception:", error);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    logger.info(`Received ${signal}, shutting down.`);
    try {
      client.destroy();
    } catch {
      // ignore
    }
    process.exit(0);
  });
}

startHealthServer(() => (client.isReady() ? "ready" : "starting"));
startDashboardServer();

await assertDavey();

logger.info("Starting Aether Discord music bot.");
await client.login(config.token);
