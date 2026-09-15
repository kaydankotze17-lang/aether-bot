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
  Partials
} from "discord.js";
import { AetherMusicManager } from "./bot/music.js";
import { createAetherDashboardBridge } from "./bot-bridge/bridge.js";

const __dirname =
  path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.static(path.join(__dirname, "public")));
const PORT =
  Number(process.env.PORT || 3000);

const isProduction =
  process.env.NODE_ENV === "production" ||
  process.env.RENDER === "true";

/* =========================
   DISCORD BOT
========================= */

const discordClient =
  new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates
    ],
    partials: [
      Partials.GuildMember
    ]
  });

const musicManager = new AetherMusicManager(discordClient);
let botReady = false;

discordClient.once(
  "clientReady",
  client => {
    botReady = true;

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
      "Discord client error:",
      error
    );
  }
);

discordClient.on(
  "warn",
  warning => {
    console.warn(
      "Discord warning:",
      warning
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

if (!process.env.DISCORD_TOKEN) {
  console.error(
    "DISCORD_TOKEN is missing."
  );
} else {
  discordClient.login(
    process.env.DISCORD_TOKEN
  ).catch(error => {
    console.error(
      "Failed to login to Discord:",
      error
    );
  });
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

app.set(
  "trust proxy",
  1
);

app.use(
  express.json({
    limit: "100kb"
  })
);

const Store =
  pgSession(session);

app.use(
  session({
    store: pool
      ? new Store({
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

    resave: false,

    saveUninitialized:
      false,

    proxy: true,

    cookie: {
      httpOnly: true,

      secure:
        isProduction,

      sameSite: "lax",

      maxAge:
        7 * 86400000
    }
  })
);
/* =========================
   DATABASE HELPERS
========================= */

async function db(sql, params = []) {
  if (!pool) {
    throw new Error(
      "DATABASE_URL is required for persistent dashboard data"
    );
  }

  return pool.query(sql, params);
}

async function initializeDatabase() {
  if (!pool) {
    console.warn(
      "DATABASE_URL is not configured."
    );

    return;
  }

  console.log(
    "Initializing Aether database..."
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
    "Aether database tables initialized successfully."
  );
}

/* =========================
   DISCORD API
========================= */

async function discord(
  pathname,
  options = {}
) {
  const response =
    await fetch(
      "https://discord.com/api/v10" +
        pathname,
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
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error =
      new Error(
        "Discord API " +
          response.status
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
   BOT STATUS
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
let dashboardBridge = null;


function botIsInGuild(
  guildId
) {
  if (!botReady) {
    return false;
  }

  return discordClient.guilds.cache.has(
    String(guildId)
  );
}

/* =========================
   PERMISSIONS
========================= */

function manageable(guild) {
  const permissions =
    BigInt(
      guild.permissions ||
        "0"
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

/* =========================
   AUTH MIDDLEWARE
========================= */

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

async function guildAuth(
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
        process.env
          .DISCORD_OAUTH_CLIENT_ID ||
        process.env
          .DISCORD_CLIENT_ID ||
        "",

      redirect_uri:
        process.env
          .DISCORD_OAUTH_REDIRECT_URI ||
        "",

      response_type:
        "code",

      scope:
        "identify guilds"
    }).toString()
  );
}
/* =========================
   LOGIN
========================= */

app.get(
  "/auth/discord",
  (_, res) => {
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
      if (!req.query.code) {
        return res
          .status(400)
          .send(
            "Missing OAuth code."
          );
      }

      const body =
        new URLSearchParams({
          client_id:
            process.env
              .DISCORD_OAUTH_CLIENT_ID ||
            process.env
              .DISCORD_CLIENT_ID ||
            "",

          client_secret:
            process.env
              .DISCORD_OAUTH_CLIENT_SECRET ||
            "",

          grant_type:
            "authorization_code",

          code:
            String(
              req.query.code
            ),

          redirect_uri:
            process.env
              .DISCORD_OAUTH_REDIRECT_URI ||
            ""
        });

      const tokenResponse =
        await fetch(
          "https://discord.com/api/v10/oauth2/token",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },

            body
          }
        );

      if (
        !tokenResponse.ok
      ) {
        const errorText =
          await tokenResponse.text();

        console.error(
          "Discord OAuth token exchange failed:",
          errorText
        );

        throw new Error(
          "OAuth exchange failed"
        );
      }

      const token =
        await tokenResponse.json();

      if (
        !token.access_token
      ) {
        throw new Error(
          "Discord did not return an access token"
        );
      }

      const [
        user,
        guilds
      ] =
        await Promise.all([
          discord(
            "/users/@me",
            {
              headers: {
                Authorization:
                  "Bearer " +
                  token.access_token
              }
            }
          ),

          discord(
            "/users/@me/guilds",
            {
              headers: {
                Authorization:
                  "Bearer " +
                  token.access_token
              }
            }
          )
        ]);

      req.session.user = {
        id:
          user.id,

        username:
          user.global_name ||
          user.username,

        avatar:
          user.avatar ||
          null
      };

      req.session.guilds =
        guilds.filter(
          manageable
        );

      console.log(
        "OAuth successful for:",
        req.session.user.username
      );

      console.log(
        "Manageable guilds:",
        req.session.guilds.length
      );

      req.session.save(
        error => {
          if (error) {
            console.error(
              "Failed to save OAuth session:",
              error
            );

            return res
              .status(500)
              .send(
                "Login succeeded, but the session could not be saved."
              );
          }

          console.log(
            "OAuth session saved successfully."
          );

          res.redirect(
            "/dashboard.html"
          );
        }
      );
    } catch (
      error
    ) {
      console.error(
        "Discord OAuth callback error:",
        error
      );

      res
        .status(500)
        .send(
          "Discord login failed. Check OAuth variables, database connection, and redirect URI."
        );
    }
  }
);

/* =========================
   LOGOUT
========================= */

app.post(
  "/auth/logout",
  (
    req,
    res
  ) => {
    req.session.destroy(
      error => {
        if (error) {
          console.error(
            "Session destroy error:",
            error
          );

          return res
            .status(500)
            .json({
              error:
                "Logout failed"
            });
        }

        res.clearCookie(
          "connect.sid"
        );

        res.json({
          ok: true
        });
      }
    );
  }
);

/* =========================
   PUBLIC CONFIG
========================= */

app.get(
  "/api/public-config",
  (
    _,
    res
  ) => {
    res.json({
      clientId:
        process.env
          .DISCORD_CLIENT_ID ||
        process.env
          .DISCORD_OAUTH_CLIENT_ID ||
        null
    });
  }
);

/* =========================
   CURRENT USER
========================= */

app.get(
  "/api/me",
  auth,
  async (
    req,
    res
  ) => {
    const liveGuilds =
      getBotGuilds();

    const botGuildIds =
      new Set(
        liveGuilds.map(
          guild =>
            guild.id
        )
      );

    const guilds =
      (
        req.session.guilds ||
        []
      ).map(
        guild => ({
          ...guild,

          botInstalled:
            botGuildIds.has(
              guild.id
            ),

          botOnline:
            botReady &&
            botGuildIds.has(
              guild.id
            )
        })
      );

    res.json({
      user:
        req.session.user,

      bot: {
        online:
          botReady,

        username:
          discordClient.user
            ?.username ||
          null,

        tag:
          discordClient.user
            ?.tag ||
          null,

        id:
          discordClient.user
            ?.id ||
          null,

        guildCount:
          liveGuilds.length
      },

      guilds
    });
  }
);
/* =========================
   GUILD META
========================= */

app.get(
  "/api/guilds/:guildId/meta",
  guildAuth,
  async (
    req,
    res
  ) => {
    const guildId =
      req.guild.id;

    const installed =
      botIsInGuild(
        guildId
      );

    let roles = [];
    let channels = [];

    if (
      installed &&
      botReady
    ) {
      try {
        const guild =
          discordClient.guilds.cache.get(
            guildId
          );

        if (guild) {
          roles =
            Array.from(
              guild.roles.cache.values()
            )
              .filter(
                role =>
                  !role.managed
              )
              .map(
                role => ({
                  id:
                    role.id,

                  name:
                    role.name,

                  position:
                    role.position,

                  color:
                    role.hexColor
                })
              );

          channels =
            Array.from(
              guild.channels.cache.values()
            )
              .filter(
                channel =>
                  channel.type === 0 ||
                  channel.type === 2
              )
              .map(
                channel => ({
                  id:
                    channel.id,

                  name:
                    channel.name,

                  type:
                    channel.type,

                  parentId:
                    channel.parentId ||
                    null
                })
              );
        }
      } catch (
        error
      ) {
        console.error(
          "Guild metadata error:",
          error
        );
      }
    }

    res.json({
      guild:
        req.guild,

      installed,

      botOnline:
        botReady,

      roles,

      channels
    });
  }
);

/* =========================
   BOT STATUS
========================= */

app.get(
  "/api/bot/status",
  auth,
  (
    req,
    res
  ) => {
    const guilds =
      getBotGuilds();

    res.json({
      online:
        botReady,

      username:
        discordClient.user
          ?.username ||
        null,

      tag:
        discordClient.user
          ?.tag ||
        null,

      id:
        discordClient.user
          ?.id ||
        null,

      guildCount:
        guilds.length,

      guilds
    });
  }
);

/* =========================
   BOT GUILD CHECK
========================= */

app.get(
  "/api/guilds/:guildId/bot",
  guildAuth,
  (
    req,
    res
  ) => {
    const guildId =
      req.guild.id;

    const installed =
      botIsInGuild(
        guildId
      );

    let guild =
      null;

    if (installed) {
      guild =
        discordClient.guilds.cache.get(
          guildId
        );
    }

    res.json({
      online:
        botReady,

      installed,

      guild:
        guild
          ? {
              id:
                guild.id,

              name:
                guild.name,

              icon:
                guild.iconURL({
                  extension:
                    "png",

                  size:
                    128
                })
            }
          : null
    });
  }
);

/* =========================
   INVITE BOT
========================= */

app.get(
  "/api/guilds/:guildId/invite",
  auth,
  (
    req,
    res
  ) => {
    const clientId =
      process.env
        .DISCORD_CLIENT_ID ||
      process.env
        .DISCORD_OAUTH_CLIENT_ID;

    if (!clientId) {
      return res
        .status(500)
        .json({
          error:
            "Discord client ID is not configured."
        });
    }

    const url =
      "https://discord.com/oauth2/authorize?" +
      new URLSearchParams({
        client_id:
          clientId,

        guild_id:
          String(
            req.params.guildId
          ),

        scope:
          "bot applications.commands",

        permissions:
          "36700160"
      }).toString();

    res.json({
      url
    });
  }
);

/* =========================
   SETTINGS DEFAULTS
========================= */

const defaults = {
  volume: 80,

  maxQueue: 100,

  autoplay:
    false,

  twentyFourSeven:
    false,

  repeat:
    "off",

  djRoleId:
    "",

  musicChannelId:
    "",

  logChannelId:
    "",

  embedColor:
    "#8b5cf6",

  nowPlayingTitle:
    "Now Playing",

  footerText:
    "Aether Music",

  language:
    "en",

  announceNowPlaying:
    true,

  deleteCommands:
    false,

  allowExternalLinks:
    true,

  sourceYouTube:
    true,

  sourceSoundCloud:
    true,

  sourceSpotify:
    true,

  sourceAppleMusic:
    true,

  sourceDeezer:
    true,

  sourceBandcamp:
    true,

  sourceTwitch:
    true,

  sourceVimeo:
    true,

  sourceRadio:
    true,

  sourceDirectUrl:
    true,

  requesterDisplay:
    true,

  showQueueButtons:
    true,

  allowPlaylists:
    true,

  allowSearch:
    true,

  defaultSearchSource:
    "youtube",

  minDjRole:
    false,

  logCommands:
    true,

  logPlayer:
    true,

  logJoins:
    true,

  enableAnalytics:
    true
};
/* =========================
   SETTINGS GET
========================= */

app.get(
  "/api/guilds/:guildId/settings",
  guildAuth,
  async (
    req,
    res
  ) => {
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

      res.json({
        ...defaults,

        ...(result.rows[0]?.config ||
          {})
      });
    } catch (
      error
    ) {
      console.error(
        "Settings load error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not load settings."
        });
    }
  }
);

/* =========================
   SETTINGS UPDATE
========================= */

app.put(
  "/api/guilds/:guildId/settings",
  guildAuth,
  async (
    req,
    res
  ) => {
    try {
      const config =
        {};

      for (
        const key of Object.keys(
          defaults
        )
      ) {
        if (
          req.body[key] !==
          undefined
        ) {
          config[key] =
            req.body[key];
        }
      }

      await db(
        `
        INSERT INTO guild_settings
        (guild_id, guild_name, config)
        VALUES ($1, $2, $3)
        ON CONFLICT(guild_id)
        DO UPDATE SET
          guild_name =
            EXCLUDED.guild_name,
          config =
            EXCLUDED.config,
          updated_at =
            NOW()
        `,
        [
          req.guild.id,
          req.guild.name,
          config
        ]
      );

      await db(
        `
        INSERT INTO audit_log
        (guild_id, user_id, action, payload)
        VALUES ($1, $2, $3, $4)
        `,
        [
          req.guild.id,
          req.session.user.id,
          "settings.update",
          config
        ]
      );

      res.json({
        ok:
          true,

        settings: {
          ...defaults,
          ...config
        }
      });
    } catch (
      error
    ) {
      console.error(
        "Settings update error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not save settings."
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
  async (
    req,
    res
  ) => {
    try {
      const liveState =
        musicManager.getState(req.guild.id);

      if (liveState) {
        return res.json(liveState);
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

      return res.json(
        result.rows[0]?.state ||
          {
            connected:
              false,

            playing:
              false,

            current:
              null,

            queue:
              [],

            volume:
              80,

            repeat:
              "off"
          }
      );
    } catch (
      error
    ) {
      console.error(
        "Player state error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not load player state."
        });
    }
  }
);

/* =========================
   PLAYER COMMANDS
========================= */

app.post(
  "/api/guilds/:guildId/player/:command",
  guildAuth,
  async (
    req,
    res
  ) => {
    const allowed = [
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
    ];

    const command =
      req.params.command;

    if (
      !allowed.includes(
        command
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            "Unknown player command"
        });
    }

    try {
      const payload =
        req.body || {};

      await db(
        `
        INSERT INTO bot_commands
        (guild_id, command, payload)
        VALUES ($1, $2, $3)
        `,
        [
          req.guild.id,
          command,
          payload
        ]
      );

      await db(
        `
        INSERT INTO audit_log
        (guild_id, user_id, action, payload)
        VALUES ($1, $2, $3, $4)
        `,
        [
          req.guild.id,
          req.session.user.id,
          "player." +
            command,
          payload
        ]
      );

      res.json({
        ok:
          true,

        queued:
          true,

        command,

        botOnline:
          botReady,

        botInstalled:
          botIsInGuild(
            req.guild.id
          )
      });
    } catch (
      error
    ) {
      console.error(
        "Player command error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not queue player command."
        });
    }
  }
);


/* =========================
   START AETHER
========================= */

async function start() {
  try {
    await initializeDatabase();

    if (pool) {
      dashboardBridge = createAetherDashboardBridge({
        databaseUrl: process.env.DATABASE_URL,
        onCommand: async ({ guildId, command, payload }) => {
          const result = await musicManager.handleCommand({
            guildId,
            command,
            payload
          });

          const liveState = musicManager.getState(guildId);

          if (liveState) {
            await db(
              `
              INSERT INTO player_state
                (guild_id, state)
              VALUES ($1, $2)
              ON CONFLICT (guild_id)
              DO UPDATE SET
                state = EXCLUDED.state,
                updated_at = NOW()
              `,
              [guildId, liveState]
            );
          }

          return result;
        }
      });
    }

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          "================================="
        );

        console.log(
          "AETHER DASHBOARD ONLINE"
        );

        console.log(
          `Port: ${PORT}`
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
      "Aether startup failed:",
      error
    );

    process.exit(1);
  }
}

start();
