import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commandJson } from "./commands/index.js";
import { logger } from "./logger.js";

export async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(config.token);
  const body = commandJson();

  if (config.guildId) {
    const data = await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body },
    );
    logger.info(`Registered ${data.length} guild slash commands for ${config.guildId}.`);
    return data;
  }

  const data = await rest.put(Routes.applicationCommands(config.clientId), { body });
  logger.info(`Registered ${data.length} global slash commands.`);
  return data;
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith("registerCommands.js");
if (isDirectRun) {
  registerCommands()
    .then(() => {
      logger.info("Command registration finished.");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("Command registration failed:", error);
      process.exit(1);
    });
}
