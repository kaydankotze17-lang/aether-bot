import { ActivityType, Events } from "discord.js";
import { logger } from "../logger.js";
import { registerCommands } from "../registerCommands.js";
import { describeConfig } from "../config.js";

export const name = Events.ClientReady;
export const once = true;

export async function execute(client) {
  logger.info(`Logged in as ${client.user.tag}`);
  logger.info("Config:", describeConfig());

  try {
    await registerCommands();
  } catch (error) {
    logger.error("Automatic slash command registration failed:", error);
  }

  client.user.setActivity("/play", { type: ActivityType.Listening });
}
