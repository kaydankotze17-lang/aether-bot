import "dotenv/config";
import express from "express";
import session from "express-session";
import pgSession from "connect-pg-simple";
import pg from "pg";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  ChannelType,
  REST,
  Routes
} from "discord.js";

import { AetherMusicManager } from "./bot/music.js";
import {
  createAetherDashboardBridge
} from "./bot-bridge/bridge.js";

const __dirname = path.dirname(
  fileURLToPath(import.meta.url)
);

const app = express();

const PORT = Number(
  process.env.PORT || 3000
);

const isProduction =
  process.env.NODE_ENV === "production" ||
  process.env.RENDER === "true";

app.use(
  express.json({
    limit: "100kb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

app.set("trust proxy", 1);

/* =========================
   DISCORD CLIENT
========================= */

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ],

  partials: [
    Partials.GuildMember
  ]
});

const musicManager =
  new AetherMusicManager(
    discordClient
  );

let botReady = false;
let dashboardBridge = null;

/* =========================
   BASIC DISCORD EVENTS
========================= */

discordClient.once(
  "clientReady",
  async client => {
    botReady = true;

    try {
      await musicManager.init();
    } catch (error) {
      console.error(
        "[Aether] Failed to initialize Lavalink:",
        error
      );
    }

    console.log(
      "================================="
    );

    console.log(
      `Aether is ONLINE as ${client.user.tag}`
    );

    console.log(
      `Bot ID: ${client.user.id}`
    );

    console.log(
      `Servers: ${client.guilds.cache.size}`
    );

    console.log(
      "================================="
    );
  }
);

discordClient.on(
  "error",
  error => {
    console.error(
      "[Discord Error]",
      error
    );
  }
);

discordClient.on(
  "warn",
  warning => {
    console.warn(
      "[Discord Warning]",
      warning
    );
  }
);

discordClient.on(
  "shardError",
  error => {
    console.error(
      "[Discord Shard Error]",
      error
    );
  }
);

/* =========================
   DISCORD LOGIN
========================= */

if (!process.env.DISCORD_TOKEN) {
  console.error(
    "[Aether] DISCORD_TOKEN is missing."
  );
} else {
  discordClient
    .login(
      process.env.DISCORD_TOKEN
    )
    .catch(error => {
      console.error(
        "[Aether] Discord login failed:",
        error
      );
    });
}
/* =========================
   SLASH COMMANDS
========================= */

const slashCommands = [
  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join a voice channel")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Voice channel to join")
        .addChannelTypes(
          ChannelType.GuildVoice,
          ChannelType.GuildStageVoice
        )
        .setRequired(true)
    )
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song or URL")
    .addStringOption(option =>
      option
        .setName("query")
        .setDescription("Song name or URL")
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Voice channel to use")
        .addChannelTypes(
          ChannelType.GuildVoice,
          ChannelType.GuildStageVoice
        )
        .setRequired(false)
    )
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause playback")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume playback")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current track")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop playback")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("shuffle")
    .setDescription("Shuffle the queue")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("previous")
    .setDescription("Play the previous track")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("Leave the voice channel")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set the player volume")
    .addIntegerOption(option =>
      option
        .setName("amount")
        .setDescription("Volume from 0 to 100")
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true)
    )
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("repeat")
    .setDescription("Set repeat mode")
    .addStringOption(option =>
      option
        .setName("mode")
        .setDescription("Repeat mode")
        .setRequired(true)
        .addChoices(
          {
            name: "Off",
            value: "off"
          },
          {
            name: "Track",
            value: "track"
          },
          {
            name: "Queue",
            value: "queue"
          }
        )
    )
    .setDMPermission(false)
].map(command => command.toJSON());

/* =========================
   REGISTER COMMANDS
========================= */

async function registerCommands() {
  if (!process.env.DISCORD_TOKEN) {
    console.error(
      "[Aether] Cannot register commands: DISCORD_TOKEN missing."
    );
    return;
  }

  const clientId =
    process.env.DISCORD_CLIENT_ID ||
    discordClient.user?.id;

  if (!clientId) {
    console.error(
      "[Aether] Cannot register commands: client ID missing."
    );
    return;
  }

  const rest = new REST({
    version: "10"
  }).setToken(
    process.env.DISCORD_TOKEN
  );

  try {
    console.log(
      `[Aether] Registering ${slashCommands.length} slash commands...`
    );

    const guilds =
      discordClient.guilds.cache;

    for (const guild of guilds.values()) {
      await rest.put(
        Routes.applicationGuildCommands(
          clientId,
          guild.id
        ),
        {
          body: slashCommands
        }
      );

      console.log(
        `[Aether] Commands registered in ${guild.name}`
      );
    }

    console.log(
      "[Aether] Slash command registration complete."
    );
  } catch (error) {
    console.error(
      "[Aether] Command registration failed:",
      error
    );
  }
}

/* =========================
   NEW SERVER
========================= */

discordClient.on(
  "guildCreate",
  async guild => {
    console.log(
      `[Aether] Joined ${guild.name}`
    );

    try {
      const rest = new REST({
        version: "10"
      }).setToken(
        process.env.DISCORD_TOKEN
      );

      await rest.put(
        Routes.applicationGuildCommands(
          discordClient.user.id,
          guild.id
        ),
        {
          body: slashCommands
        }
      );

      console.log(
        `[Aether] Commands registered in ${guild.name}`
      );
    } catch (error) {
      console.error(
        "[Aether] Failed to register new guild commands:",
        error
      );
    }
  }
);

/* =========================
   REGISTER AFTER LOGIN
========================= */

discordClient.once(
  "clientReady",
  async () => {
    await registerCommands();
  }
);
/* =========================
   SLASH COMMAND HANDLER
========================= */

discordClient.on(
  "interactionCreate",
  async interaction => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({
        content:
          "Music commands can only be used inside a server.",
        ephemeral: true
      }).catch(() => {});

      return;
    }

    const guildId =
      interaction.guildId;

    const command =
      interaction.commandName;

    try {
      await interaction.deferReply();

      let payload = {};

      /* JOIN */

      if (command === "join") {
        const channel =
          interaction.options.getChannel(
            "channel",
            true
          );

        payload = {
          voiceChannelId:
            channel.id
        };
      }

      /* PLAY */

      else if (command === "play") {
        const query =
          interaction.options.getString(
            "query",
            true
          );

        const selectedChannel =
          interaction.options.getChannel(
            "channel",
            false
          );

        const memberChannel =
          interaction.member?.voice?.channel;

        const voiceChannel =
          selectedChannel ||
          memberChannel;

        if (!voiceChannel) {
          await interaction.editReply(
            "Join a voice channel first, or choose one with the channel option."
          );

          return;
        }

        payload = {
          query,

          voiceChannelId:
            voiceChannel.id,

          requester:
            interaction.user.id,

          requesterName:
            interaction.user.username
        };
      }

      /* VOLUME */

      else if (command === "volume") {
        payload = {
          volume:
            interaction.options.getInteger(
              "amount",
              true
            )
        };
      }

      /* REPEAT */

      else if (command === "repeat") {
        payload = {
          mode:
            interaction.options.getString(
              "mode",
              true
            )
        };
      }

      /* OTHER COMMANDS */

      else if (
        [
          "pause",
          "resume",
          "skip",
          "stop",
          "shuffle",
          "previous",
          "disconnect"
        ].includes(command)
      ) {
        payload = {};
      }

      else {
        await interaction.editReply(
          "Unknown Aether command."
        );

        return;
      }

      /* SEND TO MUSIC MANAGER */

      const result =
        await musicManager.handleCommand({
          guildId,
          command,
          payload
        });

      /* SAVE CURRENT STATE */

      const state =
        musicManager.getState(
          guildId
        );

      if (pool && state) {
        await db(
          `
          INSERT INTO player_state
            (guild_id, state)
          VALUES
            ($1, $2)
          ON CONFLICT (guild_id)
          DO UPDATE SET
            state = EXCLUDED.state,
            updated_at = NOW()
          `,
          [
            guildId,
            state
          ]
        );
      }

      /* RESPONSE */

      const message =
        getCommandResponse(
          command,
          result,
          state
        );

      await interaction.editReply(
        message
      );
    } catch (error) {
      console.error(
        `[Aether] /${command} failed:`,
        error
      );

      const message =
        `Aether error: ${
          error?.message ||
          "Something went wrong."
        }`;

      if (
        interaction.deferred ||
        interaction.replied
      ) {
        await interaction
          .editReply(message)
          .catch(() => {});
      } else {
        await interaction
          .reply({
            content: message,
            ephemeral: true
          })
          .catch(() => {});
      }
    }
  }
);

/* =========================
   COMMAND RESPONSES
========================= */

function getCommandResponse(
  command,
  result,
  state
) {
  if (
    result?.message
  ) {
    return result.message;
  }

  switch (command) {
    case "join":
      return "Joined the voice channel.";

    case "play":
      return state?.current
        ? `Playing: ${state.current.title || "requested track"}`
        : "Track added to the queue.";

    case "pause":
      return "Playback paused.";

    case "resume":
      return "Playback resumed.";

    case "skip":
      return "Skipped the current track.";

    case "stop":
      return "Playback stopped.";

    case "shuffle":
      return "Queue shuffled.";

    case "previous":
      return "Previous track requested.";

    case "disconnect":
      return "Disconnected from the voice channel.";

    case "volume":
      return `Volume set to ${state?.volume ?? 80}%.`;

    case "repeat":
      return `Repeat mode set to ${state?.repeat || "off"}.`;

    default:
      return "Command completed.";
  }
}
/* =========================
   DATABASE
========================= */

const pool =
  process.env.DATABASE_URL
    ? new pg.Pool({
        connectionString:
          process.env.DATABASE_URL,

        ssl:
          isProduction
            ? {
                rejectUnauthorized:
                  false
              }
            : false
      })
    : null;

/* =========================
   SESSION
========================= */

const PgStore =
  pgSession(session);

app.use(
  session({
    store: pool
      ? new PgStore({
          pool,
          createTableIfMissing:
            true
        })
      : undefined,

    secret:
      process.env.SESSION_SECRET ||
      crypto
        .randomBytes(32)
        .toString("hex"),

    resave:
      false,

    saveUninitialized:
      false,

    proxy:
      true,

    cookie: {
      httpOnly:
        true,

      secure:
        isProduction,

      sameSite:
        "lax",

      maxAge:
        7 * 24 * 60 * 60 * 1000
    }
  })
);

/* =========================
   DATABASE HELPER
========================= */

async function db(
  sql,
  params = []
) {
  if (!pool) {
    throw new Error(
      "DATABASE_URL is not configured."
    );
  }

  return pool.query(
    sql,
    params
  );
}

/* =========================
   DATABASE INITIALIZATION
========================= */

async function initializeDatabase() {
  if (!pool) {
    console.warn(
      "[Aether] DATABASE_URL is missing."
    );

    return;
  }

  console.log(
    "[Aether] Initializing database..."
  );

  await db(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      guild_name TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS player_state (
      guild_id TEXT PRIMARY KEY,
      state JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS bot_commands (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      command TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending',
      result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log(
    "[Aether] Database ready."
  );
}

/* =========================
   DISCORD API HELPER
========================= */

async function discord(
  pathname,
  options = {}
) {
  const response =
    await fetch(
      `https://discord.com/api/v10${pathname}`,
      {
        ...options,

        headers: {
          "User-Agent":
            "AetherDashboard/2.0",

          "Content-Type":
            "application/json",

          ...(options.headers || {})
        }
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    data =
      text;
  }

  if (!response.ok) {
    const error =
      new Error(
        `Discord API ${response.status}`
      );

    error.status =
      response.status;

    error.data =
      data;

    throw error;
  }

  return data;
}
/* =========================
   AUTH HELPERS
========================= */

function manageable(guild) {
  const permissions =
    BigInt(
      guild.permissions || "0"
    );

  return (
    !!guild.owner ||
    !!(
      permissions &
      (1n << 3n)
    ) ||
    !!(
      permissions &
      (1n << 5n)
    )
  );
}

function auth(
  req,
  res,
  next
) {
  if (!req.session.user) {
    return res
      .status(401)
      .json({
        error:
          "Not authenticated"
      });
  }

  next();
}

function guildAuth(
  req,
  res,
  next
) {
  if (!req.session.user) {
    return res
      .status(401)
      .json({
        error:
          "Not authenticated"
      });
  }

  const guildId =
    String(
      req.params.guildId
    );

  const guild =
    (
      req.session.guilds ||
      []
    ).find(
      guild =>
        guild.id ===
        guildId
    );

  if (
    !guild ||
    !manageable(guild)
  ) {
    return res
      .status(403)
      .json({
        error:
          "You cannot manage this server."
      });
  }

  req.guild =
    guild;

  next();
}

/* =========================
   OAUTH URL
========================= */

function oauth() {
  return (
    "https://discord.com/oauth2/authorize?" +
    new URLSearchParams({
      client_id:
        process.env.DISCORD_CLIENT_ID ||
        "",

      redirect_uri:
        process.env.DISCORD_OAUTH_REDIRECT_URI ||
        "",

      response_type:
        "code",

      scope:
        "identify guilds"
    }).toString()
  );
}

/* =========================
   OAUTH LOGIN
========================= */

app.get(
  "/auth/discord",
  (req, res) => {
    res.redirect(
      oauth()
    );
  }
);

/* =========================
   OAUTH CALLBACK
========================= */

app.get(
  "/auth/discord/callback",
  async (
    req,
    res
  ) => {
    try {
      const code =
        req.query.code;

      if (!code) {
        return res
          .status(400)
          .send(
            "Missing OAuth code."
          );
      }

      const params =
        new URLSearchParams();

      params.set(
        "client_id",
        process.env.DISCORD_CLIENT_ID ||
          ""
      );

      params.set(
        "client_secret",
        process.env.DISCORD_OAUTH_CLIENT_SECRET ||
          ""
      );

      params.set(
        "grant_type",
        "authorization_code"
      );

      params.set(
        "code",
        code
      );

      params.set(
        "redirect_uri",
        process.env.DISCORD_OAUTH_REDIRECT_URI ||
          ""
      );

      const tokenResponse =
        await fetch(
          "https://discord.com/api/oauth2/token",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },

            body:
              params.toString()
          }
        );

      if (!tokenResponse.ok) {
        console.error(
          "[Aether] OAuth token exchange failed."
        );

        return res
          .status(500)
          .send(
            "Discord OAuth failed."
          );
      }

      const tokenData =
        await tokenResponse.json();

      const userResponse =
        await fetch(
          "https://discord.com/api/v10/users/@me",
          {
            headers: {
              Authorization:
                `Bearer ${tokenData.access_token}`
            }
          }
        );

      const user =
        await userResponse.json();

      const guildResponse =
        await fetch(
          "https://discord.com/api/v10/users/@me/guilds",
          {
            headers: {
              Authorization:
                `Bearer ${tokenData.access_token}`
            }
          }
        );

      const guilds =
        guildResponse.ok
          ? await guildResponse.json()
          : [];

      const manageableGuilds =
        guilds.filter(
          guild =>
            manageable(guild)
        );

      req.session.user =
        user;

      req.session.guilds =
        manageableGuilds;

      req.session.accessToken =
        tokenData.access_token;

      req.session.refreshToken =
        tokenData.refresh_token ||
        null;

      req.session.save(
        error => {
          if (error) {
            console.error(
              "[Aether] Session save failed:",
              error
            );

            return res
              .status(500)
              .send(
                "Failed to save login session."
              );
          }

          console.log(
            `OAuth successful for: ${user.username}`
          );

          console.log(
            `Manageable guilds: ${manageableGuilds.length}`
          );

          res.redirect(
            "/"
          );
        }
      );
    } catch (error) {
      console.error(
        "[Aether] OAuth callback error:",
        error
      );

      res
        .status(500)
        .send(
          "Authentication failed."
        );
    }
  }
);

/* =========================
   LOGOUT
========================= */

app.get(
  "/auth/logout",
  (req, res) => {
    req.session.destroy(
      () => {
        res.redirect(
          "/"
        );
      }
    );
  }
);

/* =========================
   CURRENT USER
========================= */

app.get(
  "/api/me",
  (req, res) => {
    if (!req.session.user) {
      return res.json({
        authenticated:
          false,

        user:
          null,

        guilds:
          []
      });
    }

    res.json({
      authenticated:
        true,

      user:
        req.session.user,

      guilds:
        req.session.guilds ||
        []
    });
  }
);

/* =========================
   PUBLIC CONFIG
========================= */

app.get(
  "/api/public-config",
  (req, res) => {
    res.json({
      clientId:
        process.env.DISCORD_CLIENT_ID ||
        null,

      loginUrl:
        oauth(),

      botReady,

      botGuildCount:
        discordClient.guilds.cache.size
    });
  }
);
/* =========================
   BOT / GUILD HELPERS
========================= */

function getBotGuilds() {
  if (!botReady) {
    return [];
  }

  return Array.from(
    discordClient.guilds.cache.values()
  ).map(guild => ({
    id: guild.id,

    name: guild.name,

    icon: guild.icon
      ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
      : null
  }));
}

async function botIsInGuild(guildId) {
  if (!botReady || !discordClient.user) {
    return false;
  }

  try {
    const guild = await discordClient.guilds.fetch(String(guildId));
    return Boolean(guild);
  } catch {
    return false;
  }
}

/* =========================
   BOT STATUS
========================= */

app.get(
  "/api/bot/status",
  auth,
  (req, res) => {
    res.json({
      ready:
        botReady,

      user:
        botReady
          ? {
              id:
                discordClient.user.id,

              tag:
                discordClient.user.tag,

              username:
                discordClient.user.username,

              avatar:
                discordClient.user.displayAvatarURL({
                  size: 128
                })
            }
          : null,

      guildCount:
        discordClient.guilds.cache.size,

      guilds:
        getBotGuilds()
    });
  }
);

/* =========================
   BOT GUILD CHECK
========================= */

app.get(
  "/api/guilds/:guildId/bot",
  guildAuth,
  async (req, res) => {
    const guildId = String(req.params.guildId);
    const installed = await botIsInGuild(guildId);

    res.json({
      guildId,
      botReady,
      installed
    });
  }
);

/* =========================
   GUILD META
========================= */

app.get(
  "/api/guilds/:guildId/meta",
  guildAuth,
  (req, res) => {
    try {
      const guild =
        discordClient.guilds.cache.get(
          req.guild.id
        );

      if (!guild) {
        return res.json({
          guild:
            req.guild,

          channels:
            []
        });
      }

      const channels =
        guild.channels.cache
          .filter(channel =>
            channel.type ===
              ChannelType.GuildText ||
            channel.type ===
              ChannelType.GuildVoice ||
            channel.type ===
              ChannelType.GuildStageVoice
          )
          .map(channel => ({
            id:
              channel.id,

            name:
              channel.name,

            type:
              channel.type,

            parentId:
              channel.parentId,

            position:
              channel.position
          }))
          .sort(
            (a, b) =>
              a.position -
              b.position
          );

      res.json({
        guild: {
          id:
            guild.id,

          name:
            guild.name,

          icon:
            guild.icon
              ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
              : null
        },

        channels
      });
    } catch (error) {
      console.error(
        "[Aether] Guild meta error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Failed to load server information."
        });
    }
  }
);

/* =========================
   BOT INVITE
========================= */

app.get(
  "/api/guilds/:guildId/invite",
  guildAuth,
  (req, res) => {
    const clientId =
      process.env.DISCORD_CLIENT_ID;

    if (!clientId) {
      return res
        .status(500)
        .json({
          error:
            "DISCORD_CLIENT_ID is missing."
        });
    }

    const permissions =
      36700160;

    const invite =
      "https://discord.com/oauth2/authorize?" +
      new URLSearchParams({
        client_id:
          clientId,

        scope:
          "bot applications.commands",

        permissions:
          String(
            permissions
          ),

        guild_id:
          req.params.guildId
      }).toString();

    res.json({
      invite
    });
  }
);

/* =========================
   SETTINGS
========================= */

const defaultSettings = {
  prefix:
    "/",

  defaultVolume:
    80,

  announceTracks:
    true,

  autoJoin:
    false,

  autoLeave:
    true,

  maxQueue:
    100,

  djRole:
    "",

  allowedChannels:
    [],

  defaultRepeat:
    "off"
};

app.get(
  "/api/guilds/:guildId/settings",
  guildAuth,
  async (req, res) => {
    try {
      const result =
        await db(
          `
          SELECT config
          FROM guild_settings
          WHERE guild_id = $1
          `,
          [
            req.guild.id
          ]
        );

      const config =
        result.rows.length
          ? result.rows[0].config
          : {};

      res.json({
        ...defaultSettings,
        ...config
      });
    } catch (error) {
      console.error(
        "[Aether] Settings error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Failed to load settings."
        });
    }
  }
);

app.put(
  "/api/guilds/:guildId/settings",
  guildAuth,
  async (req, res) => {
    try {
      const config = {
        ...defaultSettings,
        ...(req.body || {})
      };

      await db(
        `
        INSERT INTO guild_settings
          (guild_id, guild_name, config)
        VALUES
          ($1, $2, $3)
        ON CONFLICT (guild_id)
        DO UPDATE SET
          guild_name = EXCLUDED.guild_name,
          config = EXCLUDED.config,
          updated_at = NOW()
        `,
        [
          req.guild.id,
          req.guild.name,
          config
        ]
      );

      res.json({
        success:
          true,

        settings:
          config
      });
    } catch (error) {
      console.error(
        "[Aether] Settings save error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Failed to save settings."
        });
    }
  }
);
/* =========================
   PLAYER STATE
========================= */

app.get(
  "/api/guilds/:guildId/player",
  guildAuth,
  async (req, res) => {
    try {
      const liveState =
        musicManager.getState(
          req.guild.id
        );

      if (liveState) {
        return res.json(
          liveState
        );
      }

      if (!pool) {
        return res.json({
          playing: false,
          paused: false,
          current: null,
          queue: [],
          volume: 80,
          repeat: "off",
          connected: false
        });
      }

      const result =
        await db(
          `
          SELECT state
          FROM player_state
          WHERE guild_id = $1
          `,
          [
            req.guild.id
          ]
        );

      if (result.rows.length) {
        return res.json(
          result.rows[0].state
        );
      }

      res.json({
        playing: false,
        paused: false,
        current: null,
        queue: [],
        volume: 80,
        repeat: "off",
        connected: false
      });
    } catch (error) {
      console.error(
        "[Aether] Player state error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load player."
      });
    }
  }
);

/* =========================
   PLAYER COMMANDS
========================= */

const playerCommands =
  new Set([
    "join",
    "play",
    "pause",
    "resume",
    "skip",
    "stop",
    "shuffle",
    "previous",
    "disconnect",
    "volume",
    "repeat",
    "clear"
  ]);

app.post(
  "/api/guilds/:guildId/player/:command",
  guildAuth,
  async (req, res) => {
    const command =
      String(
        req.params.command
      );

    if (
      !playerCommands.has(
        command
      )
    ) {
      return res.status(400).json({
        error:
          "Unknown player command."
      });
    }

    try {
      const payload =
        req.body || {};

      if (pool) {
        await db(
          `
          INSERT INTO audit_log
            (guild_id, user_id, action, payload)
          VALUES
            ($1, $2, $3, $4)
          `,
          [
            req.guild.id,
            req.session.user.id,
            `player.${command}`,
            payload
          ]
        );
      }

      const result =
        await musicManager.handleCommand({
          guildId:
            req.guild.id,

          command,

          payload
        });

      const state =
        musicManager.getState(
          req.guild.id
        );

      if (pool && state) {
        await db(
          `
          INSERT INTO player_state
            (guild_id, state)
          VALUES
            ($1, $2)
          ON CONFLICT (guild_id)
          DO UPDATE SET
            state = EXCLUDED.state,
            updated_at = NOW()
          `,
          [
            req.guild.id,
            state
          ]
        );
      }

      res.json({
        success: true,

        result,

        state:
          state || null
      });
    } catch (error) {
      console.error(
        "[Aether] Player command error:",
        error
      );

      res.status(400).json({
        error:
          error.message ||
          "Player command failed."
      });
    }
  }
);

/* =========================
   ANALYTICS
========================= */

app.get(
  "/api/guilds/:guildId/analytics",
  guildAuth,
  async (req, res) => {
    try {
      if (!pool) {
        return res.json({
          events: []
        });
      }

      const days = Math.min(
        Math.max(
          Number(
            req.query.days
          ) || 30,
          1
        ),
        90
      );

      const result =
        await db(
          `
          SELECT
            event_type,
            COUNT(*)::int AS count
          FROM analytics_events
          WHERE guild_id = $1
            AND created_at >=
              NOW() -
              ($2 * INTERVAL '1 day')
          GROUP BY event_type
          ORDER BY count DESC
          `,
          [
            req.guild.id,
            days
          ]
        );

      res.json({
        events:
          result.rows
      });
    } catch (error) {
      console.error(
        "[Aether] Analytics error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load analytics."
      });
    }
  }
);

/* =========================
   AUDIT LOG
========================= */

app.get(
  "/api/guilds/:guildId/audit",
  guildAuth,
  async (req, res) => {
    try {
      if (!pool) {
        return res.json({
          entries: []
        });
      }

      const result =
        await db(
          `
          SELECT
            id,
            user_id,
            action,
            payload,
            created_at
          FROM audit_log
          WHERE guild_id = $1
          ORDER BY created_at DESC
          LIMIT 100
          `,
          [
            req.guild.id
          ]
        );

      res.json({
        entries:
          result.rows
      });
    } catch (error) {
      console.error(
        "[Aether] Audit error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load audit log."
      });
    }
  }
);
/* =========================
   DASHBOARD BRIDGE
========================= */

async function savePlayerState(
  guildId
) {
  if (!pool) {
    return;
  }

  const state =
    musicManager.getState(
      guildId
    );

  if (!state) {
    return;
  }

  await db(
    `
    INSERT INTO player_state
      (guild_id, state)
    VALUES
      ($1, $2)
    ON CONFLICT (guild_id)
    DO UPDATE SET
      state = EXCLUDED.state,
      updated_at = NOW()
    `,
    [
      guildId,
      state
    ]
  );
}

async function handleDashboardCommand({
  guildId,
  command,
  payload
}) {
  const result =
    await musicManager.handleCommand({
      guildId,
      command,
      payload
    });

  await savePlayerState(
    guildId
  );

  return result;
}

/* =========================
   START SERVER
========================= */

async function start() {
  try {
    await initializeDatabase();

    if (
      pool &&
      !dashboardBridge
    ) {
      dashboardBridge =
        createAetherDashboardBridge({
          databaseUrl:
            process.env.DATABASE_URL,

          onCommand:
            handleDashboardCommand
        });

      console.log(
        "[Aether] Dashboard bridge started."
      );
    }

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          "================================="
        );

        console.log(
          `Aether dashboard running on port ${PORT}`
        );

        console.log(
          `Environment: ${
            isProduction
              ? "production"
              : "development"
          }`
        );

        console.log(
          "================================="
        );
      }
    );
  } catch (error) {
    console.error(
      "[Aether] Startup failed:",
      error
    );

    process.exit(1);
  }
}

start();

/* =========================
   PROCESS ERRORS
========================= */

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "[Aether] Unhandled rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "[Aether] Uncaught exception:",
      error
    );
  }
);
