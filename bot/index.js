import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Events
} from "discord.js";

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error(
    "[AETHER BOT] DISCORD_TOKEN is missing."
  );
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.once(
  Events.ClientReady,
  readyClient => {
    console.log(
      `[AETHER BOT] ONLINE as ${readyClient.user.tag}`
    );

    console.log(
      `[AETHER BOT] Connected to ${readyClient.guilds.cache.size} server(s).`
    );

    for (const guild of readyClient.guilds.cache.values()) {
      console.log(
        `[AETHER BOT] Server: ${guild.name} (${guild.id})`
      );
    }
  }
);

client.on(
  Events.GuildCreate,
  guild => {
    console.log(
      `[AETHER BOT] Joined server: ${guild.name} (${guild.id})`
    );
  }
);

client.on(
  Events.GuildDelete,
  guild => {
    console.log(
      `[AETHER BOT] Left server: ${guild.name} (${guild.id})`
    );
  }
);

client.on(
  Events.Error,
  error => {
    console.error(
      "[AETHER BOT] Discord client error:",
      error
    );
  }
);

client.on(
  Events.Warn,
  warning => {
    console.warn(
      "[AETHER BOT] Discord warning:",
      warning
    );
  }
);

process.on(
  "SIGTERM",
  async () => {
    console.log(
      "[AETHER BOT] Shutting down..."
    );

    client.destroy();

    process.exit(0);
  }
);

process.on(
  "SIGINT",
  async () => {
    console.log(
      "[AETHER BOT] Shutting down..."
    );

    client.destroy();

    process.exit(0);
  }
);

console.log(
  "[AETHER BOT] Starting Discord client..."
);

client.login(token).catch(error => {
  console.error(
    "[AETHER BOT] Login failed:",
    error
  );

  process.exit(1);
});
