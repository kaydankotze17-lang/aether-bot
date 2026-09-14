import { config as loadEnv } from "dotenv";

loadEnv();

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  token: required("DISCORD_TOKEN"),
  clientId: required("CLIENT_ID"),
  guildId: process.env.GUILD_ID?.trim() || "",
  port: Number.parseInt(process.env.PORT || "3000", 10),
  dashboardPort: Number.parseInt(process.env.DASHBOARD_PORT || process.env.PORT || "3000", 10) + 1,
  dashboardToken: process.env.DASHBOARD_TOKEN?.trim() || "",
  emptyChannelTimeoutMs: 5 * 60 * 1000,
  maxQueueSize: 100,
  userAgent: "AetherDiscordBot/1.0",
  appName: "AetherDiscordBot",
};

export function describeConfig() {
  return {
    clientId: config.clientId,
    guildId: config.guildId || "(global commands)",
    port: config.port,
  };
}
