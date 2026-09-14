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
  GatewayIntentBits
} from "discord.js";

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

/* =========================
   DISCORD BOT
========================= */

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

let botReady = false;
let botUser = null;
let botLoginError = null;

discordClient.once(
  "ready",
  client => {
    botReady = true;
    botLoginError = null;
    botUser = client.user;

    console.log(
      "================================"
    );

    console.log(
      "AETHER DISCORD BOT ONLINE"
    );

    console.log(
      `Logged in as: ${client.user.tag}`
    );

    console.log(
      `Bot ID: ${client.user.id}`
    );

    console.log(
      `Servers: ${client.guilds.cache.size}`
    );

    console.log(
      "================================"
    );
  }
);

discordClient.on(
  "guildCreate",
  guild => {
    console.log(
      `Bot joined server: ${guild.name} (${guild.id})`
    );

    console.log(
      `Current bot servers: ${discordClient.guilds.cache.size}`
    );
  }
);

discordClient.on(
  "guildDelete",
  guild => {
    console.log(
      `Bot left server: ${guild.name} (${guild.id})`
    );

    console.log(
      `Current bot servers: ${discordClient.guilds.cache.size}`
    );
  }
);

discordClient.on(
  "error",
  error => {
    console.error(
      "Discord client error:",
      error
    );
  }
);

discordClient.on(
  "shardError",
  error => {
    console.error(
      "Discord shard error:",
      error
    );
  }
);

async function startDiscordBot() {
  if (!process.env.DISCORD_TOKEN) {
    botLoginError =
      "DISCORD_TOKEN is not configured.";

    console.error(
      "AETHER BOT ERROR: DISCORD_TOKEN is missing."
    );

    return;
  }

  try {
    console.log(
      "Starting Aether Discord bot..."
    );

    await discordClient.login(
      process.env.DISCORD_TOKEN
    );
  } catch (error) {
    botLoginError =
      error?.message ||
      "Discord bot login failed.";

    console.error(
      "Aether Discord bot login failed:",
      error
    );
  }
}

/* =========================
   DATABASE
========================= */

const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString:
        process.env.DATABASE_URL,

      ssl: isProduction
        ? {
            rejectUnauthorized: false
          }
        : false
    })
  : null;

app.set(
  "trust proxy",
  1
);

app.use(
  express.json({
    limit: "100kb"
  })
);

const Store = pgSession(session);

app.use(
  session({
    store: pool
      ? new Store({
          pool,
          createTableIfMissing: true
        })
      : undefined,

    secret:
      process.env.SESSION_SECRET ||
      crypto
        .randomBytes(32)
        .toString("hex"),

    resave: false,

    saveUninitialized: false,

    proxy: true,

    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge:
        7 * 86400000
    }
  })
);

/* =========================
   DATABASE HELPERS
========================= */

async function db(
  text,
  params = []
) {
  if (!pool) {
    throw new Error(
      "DATABASE_URL is not configured."
    );
  }

  return pool.query(
    text,
    params
  );
}

async function initializeDatabase() {
  if (!pool) {
    console.warn(
      "DATABASE_URL is missing. Database features are disabled."
    );

    return;
  }

  try {
    await db(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        guild_id TEXT PRIMARY KEY,
        settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db(`
      CREATE TABLE IF NOT EXISTS bot_commands (
        id BIGSERIAL PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        command TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'queued',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id BIGSERIAL PRIMARY KEY,
        guild_id TEXT,
        user_id TEXT,
        event TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        guild_id TEXT,
        user_id TEXT,
        action TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    console.log(
      "Database initialized successfully."
    );
  } catch (error) {
    console.error(
      "Database initialization failed:",
      error
    );
  }
}

/* =========================
   DISCORD REST
========================= */

async function discord(
  endpoint,
  options = {}
) {
  const token =
    process.env.DISCORD_TOKEN;

  if (!token) {
    throw new Error(
      "DISCORD_TOKEN is not configured."
    );
  }

  const response =
    await fetch(
      `https://discord.com/api/v10${endpoint}`,
      {
        ...options,

        headers: {
          Authorization:
            `Bot ${token}`,

          "Content-Type":
            "application/json",

          ...(options.headers || {})
        }
      }
    );

  const text =
    await response.text();

  let data = null;

  try {
    data = text
      ? JSON.parse(text)
      : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error =
      new Error(
        `Discord API ${response.status}`
      );

    error.status =
      response.status;

    error.data = data;

    throw error;
  }

  return data;
}

async function botDiscord(
  endpoint,
  options = {}
) {
  return discord(
    endpoint,
    options
  );
}

/* =========================
   LIVE BOT GUILDS
========================= */

function getLiveBotGuilds() {
  return Array.from(
    discordClient.guilds.cache.values()
  );
}

function botIsInGuild(
  guildId
) {
  if (!guildId) {
    return false;
  }

  return discordClient.guilds.cache.has(
    String(guildId)
  );
}

/* =========================
   PERMISSIONS
========================= */

function manageable(
  guild
) {
  if (!guild) {
    return false;
  }

  const permissions =
    BigInt(
      guild.permissions ??
      "0"
    );

  const ADMINISTRATOR =
    0x8n;

  const MANAGE_GUILD =
    0x20n;

  return Boolean(
    permissions &
    ADMINISTRATOR
  ) ||
  Boolean(
    permissions &
    MANAGE_GUILD
  );
}

/* =========================
   AUTH
========================= */

function auth(
  req,
  res,
  next
) {
  if (!req.session?.user) {
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
  if (!req.session?.user) {
    return res
      .status(401)
      .json({
        error:
          "Not authenticated"
      });
  }

  const guildId =
    String(
      req.params.guildId ||
      req.body?.guildId ||
      req.query?.guildId ||
      ""
    );

  if (!guildId) {
    return res
      .status(400)
      .json({
        error:
          "Guild ID is required"
      });
  }

  const manageableGuilds =
    req.session.user.guilds ||
    [];

  const guild =
    manageableGuilds.find(
      item =>
        String(item.id) ===
        guildId
    );

  if (!guild) {
    return res
      .status(403)
      .json({
        error:
          "You do not have access to this server."
      });
  }

  req.guild =
    guild;

  next();
}

/* =========================
   DISCORD OAUTH
========================= */

function oauth() {
  const clientId =
    process.env.DISCORD_CLIENT_ID;

  const redirectUri =
    process.env.DISCORD_OAUTH_REDIRECT_URI;

  const params =
    new URLSearchParams({
      client_id:
        clientId,

      redirect_uri:
        redirectUri,

      response_type:
        "code",

      scope:
        "identify guilds"
    });

  return (
    "https://discord.com/oauth2/authorize?" +
    params.toString()
  );
}

/* =========================
   DEFAULT SETTINGS
========================= */

const defaults = {
  prefix: "/",

  volume: 80,

  defaultVolume: 80,

  autoplay: true,

  loop: "off",

  announceNowPlaying: true,

  deleteCommands: false,

  djOnly: false,

  twentyFourSeven: false,

  defaultFilter: "none",

  defaultSource: "youtube",

  maxQueueSize: 100,

  leaveOnEmpty: true,

  leaveOnEmptyDelay: 300000,

  inactivityTimeout: 600000,

  embedColor: "#5865F2"
};

/* =========================
   LOGIN
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
  async (req, res) => {
    const code =
      String(
        req.query.code || ""
      );

    if (!code) {
      return res
        .status(400)
        .send(
          "Missing Discord authorization code."
        );
    }

    try {
      const tokenResponse =
        await fetch(
          "https://discord.com/api/oauth2/token",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },

            body:
              new URLSearchParams({
                client_id:
                  process.env.DISCORD_CLIENT_ID,

                client_secret:
                  process.env.DISCORD_OAUTH_CLIENT_SECRET,

                grant_type:
                  "authorization_code",

                code,

                redirect_uri:
                  process.env.DISCORD_OAUTH_REDIRECT_URI
              })
          }
        );

      const tokenData =
        await tokenResponse.json();

      if (
        !tokenResponse.ok ||
        !tokenData.access_token
      ) {
        console.error(
          "Discord OAuth token exchange failed:",
          tokenData
        );

        return res
          .status(401)
          .send(
            "Discord authorization failed."
          );
      }

      const accessToken =
        tokenData.access_token;

      const userResponse =
        await fetch(
          "https://discord.com/api/v10/users/@me",
          {
            headers: {
              Authorization:
                `Bearer ${accessToken}`
            }
          }
        );

      const user =
        await userResponse.json();

      if (!userResponse.ok) {
        return res
          .status(401)
          .send(
            "Could not retrieve your Discord account."
          );
      }

      const guildResponse =
        await fetch(
          "https://discord.com/api/v10/users/@me/guilds",
          {
            headers: {
              Authorization:
                `Bearer ${accessToken}`
            }
          }
        );

      const userGuilds =
        guildResponse.ok
          ? await guildResponse.json()
          : [];

      const manageableGuilds =
        Array.isArray(userGuilds)
          ? userGuilds.filter(
              guild =>
                manageable(guild)
            )
          : [];

      req.session.user = {
        id:
          user.id,

        username:
          user.username,

        globalName:
          user.global_name ||
          user.username,

        avatar:
          user.avatar || null,

        guilds:
          manageableGuilds
      };

      req.session.accessToken =
        accessToken;

      await new Promise(
        (resolve, reject) => {
          req.session.save(
            error => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            }
          );
        }
      );

      console.log(
        `OAuth successful for: ${user.global_name || user.username}`
      );

      console.log(
        `Manageable guilds: ${manageableGuilds.length}`
      );

      console.log(
        "OAuth session saved successfully."
      );

      res.redirect("/");
    } catch (error) {
      console.error(
        "OAuth callback error:",
        error
      );

      res
        .status(500)
        .send(
          "Discord login failed."
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
      error => {
        if (error) {
          console.error(
            "Session destroy error:",
            error
          );
        }

        res.redirect("/");
      }
    );
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

      inviteUrl:
        process.env.DISCORD_CLIENT_ID
          ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(
              process.env.DISCORD_CLIENT_ID
            )}&scope=bot%20applications.commands&permissions=0`
          : null
    });
  }
);

/* =========================
   BOT STATUS
========================= */

app.get(
  "/api/bot-status",
  (req, res) => {
    const guilds =
      getLiveBotGuilds();

    res.json({
      online:
        botReady,

      botOnline:
        botReady,

      bot: botUser
        ? {
            id:
              botUser.id,

            username:
              botUser.username,

            tag:
              botUser.tag
          }
        : null,

      serverCount:
        guilds.length,

      servers:
        guilds.map(
          guild => ({
            id:
              guild.id,

            name:
              guild.name,

            icon:
              guild.iconURL?.({
                extension: "png",
                size: 128
              }) || null
          })
        ),

      error:
        botLoginError
    });
  }
);

/* =========================
   CURRENT USER
========================= */

app.get(
  "/api/me",
  auth,
  async (req, res) => {
    const user =
      req.session.user;

    const liveGuilds =
      getLiveBotGuilds();

    const guilds =
      (user.guilds || [])
        .map(guild => ({
          ...guild,

          botInstalled:
            botIsInGuild(
              guild.id
            ),

          botOnline:
            botReady &&
            botIsInGuild(
              guild.id
            )
        }));

    res.json({
      user: {
        id:
          user.id,

        username:
          user.username,

        globalName:
          user.globalName,

        avatar:
          user.avatar
      },

      guilds,

      bot: {
        online:
          botReady,

        serverCount:
          liveGuilds.length,

        user:
          botUser
            ? {
                id:
                  botUser.id,

                username:
                  botUser.username,

                tag:
                  botUser.tag
              }
            : null
      }
    });
  }
);

/* =========================
   GUILD META
========================= */

app.get(
  "/api/guilds/:guildId/meta",
  auth,
  guildAuth,
  async (req, res) => {
    const guildId =
      String(
        req.params.guildId
      );

    const botInstalled =
      botIsInGuild(
        guildId
      );

    let botGuild = null;

    if (botInstalled) {
      botGuild =
        discordClient.guilds.cache.get(
          guildId
        );
    }

    res.json({
      guild: {
        id:
          req.guild.id,

        name:
          req.guild.name,

        icon:
          req.guild.icon ||
          null
      },

      botInstalled,

      botOnline:
        botReady &&
        botInstalled,

      bot: botGuild
        ? {
            id:
              botGuild.id,

            name:
              botGuild.name,

            memberCount:
              botGuild.memberCount,

            icon:
              botGuild.iconURL?.({
                extension: "png",
                size: 128
              }) || null
          }
        : null
    });
  }
);

/* =========================
   SETTINGS
========================= */

app.get(
  "/api/guilds/:guildId/settings",
  auth,
  guildAuth,
  async (req, res) => {
    try {
      const result =
        await db(
          `
          SELECT settings
          FROM bot_settings
          WHERE guild_id = $1
          `,
          [
            req.params.guildId
          ]
        );

      const stored =
        result.rows[0]?.settings ||
        {};

      res.json({
        guildId:
          req.params.guildId,

        settings: {
          ...defaults,
          ...stored
        }
      });
    } catch (error) {
      console.error(
        "Settings GET error:",
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
  auth,
  guildAuth,
  async (req, res) => {
    try {
      const incoming =
        req.body &&
        typeof req.body === "object"
          ? req.body
          : {};

      const settings = {
        ...defaults,
        ...incoming
      };

      await db(
        `
        INSERT INTO bot_settings
          (
            guild_id,
            settings,
            updated_at
          )
        VALUES
          (
            $1,
            $2::jsonb,
            NOW()
          )
        ON CONFLICT (guild_id)
        DO UPDATE SET
          settings = EXCLUDED.settings,
          updated_at = NOW()
        `,
        [
          req.params.guildId,
          JSON.stringify(
            settings
          )
        ]
      );

      await db(
        `
        INSERT INTO audit_logs
          (
            guild_id,
            user_id,
            action,
            metadata
          )
        VALUES
          (
            $1,
            $2,
            $3,
            $4::jsonb
          )
        `,
        [
          req.params.guildId,

          req.session.user.id,

          "settings_updated",

          JSON.stringify({
            keys:
              Object.keys(
                incoming
              )
          })
        ]
      );

      res.json({
        ok: true,

        settings
      });
    } catch (error) {
      console.error(
        "Settings PUT error:",
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
  auth,
  guildAuth,
  async (req, res) => {
    const guildId =
      String(
        req.params.guildId
      );

    const botInstalled =
      botIsInGuild(
        guildId
      );

    res.json({
      guildId,

      botInstalled,

      botOnline:
        botReady &&
        botInstalled,

      connected:
        false,

      playing:
        false,

      paused:
        false,

      volume:
        80,

      loop:
        "off",

      position:
        0,

      duration:
        0,

      current:
        null,

      queue:
        []
    });
  }
);

/* =========================
   PLAYER COMMANDS
========================= */

app.post(
  "/api/guilds/:guildId/player",
  auth,
  guildAuth,
  async (req, res) => {
    const guildId =
      String(
        req.params.guildId
      );

    const botInstalled =
      botIsInGuild(
        guildId
      );

    if (!botReady) {
      return res
        .status(503)
        .json({
          error:
            "The Aether bot is currently offline."
        });
    }

    if (!botInstalled) {
      return res
        .status(409)
        .json({
          error:
            "Aether is not installed in this server."
        });
    }

    const command =
      String(
        req.body?.command ||
        ""
      ).trim();

    if (!command) {
      return res
        .status(400)
        .json({
          error:
            "Command is required."
        });
    }

    const payload =
      req.body?.payload &&
      typeof req.body.payload ===
        "object"
        ? req.body.payload
        : {};

    try {
      const result =
        await db(
          `
          INSERT INTO bot_commands
            (
              guild_id,
              user_id,
              command,
              payload,
              status
            )
          VALUES
            (
              $1,
              $2,
              $3,
              $4::jsonb,
              'queued'
            )
          RETURNING
            id,
            guild_id,
            user_id,
            command,
            payload,
            status,
            created_at
          `,
          [
            guildId,

            req.session.user.id,

            command,

            JSON.stringify(
              payload
            )
          ]
        );

      const commandRow =
        result.rows[0];

      res.json({
        ok: true,

        command:
          commandRow
      });
    } catch (error) {
      console.error(
        "Player command error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Failed to queue player command."
        });
    }
  }
);

/* =========================
   ANALYTICS
========================= */

app.get(
  "/api/guilds/:guildId/analytics",
  auth,
  guildAuth,
  async (req, res) => {
    try {
      const result =
        await db(
          `
          SELECT
            event,
            COUNT(*)::int AS count
          FROM analytics_events
          WHERE guild_id = $1
          GROUP BY event
          ORDER BY count DESC
          `,
          [
            req.params.guildId
          ]
        );

      res.json({
        guildId:
          req.params.guildId,

        events:
          result.rows
      });
    } catch (error) {
      console.error(
        "Analytics error:",
        error
      );

      res
        .status(500)
        .json({
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
  auth,
  guildAuth,
  async (req, res) => {
    try {
      const result =
        await db(
          `
          SELECT
            id,
            guild_id,
            user_id,
            action,
            metadata,
            created_at
          FROM audit_logs
          WHERE guild_id = $1
          ORDER BY created_at DESC
          LIMIT 100
          `,
          [
            req.params.guildId
          ]
        );

      res.json({
        guildId:
          req.params.guildId,

        logs:
          result.rows
      });
    } catch (error) {
      console.error(
        "Audit log error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Failed to load audit logs."
        });
    }
  }
);

/* =========================
   STATIC FILES
========================= */

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);

/* =========================
   ROOT
========================= */

app.get(
  "/",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/* =========================
   ERROR HANDLER
========================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "Unhandled server error:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res
      .status(500)
      .json({
        error:
          "Internal server error."
      });
  }
);

/* =========================
   START SERVER
========================= */

async function start() {
  await initializeDatabase();

  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        "================================"
      );

      console.log(
        "AETHER DASHBOARD ONLINE"
      );

      console.log(
        `Port: ${PORT}`
      );

      console.log(
        `Production: ${isProduction}`
      );

      console.log(
        "================================"
      );
    }
  );

  await startDiscordBot();
}

start().catch(
  error => {
    console.error(
      "Aether startup failed:",
      error
    );

    process.exit(1);
  }
);
