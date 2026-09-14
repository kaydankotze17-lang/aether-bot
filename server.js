import "dotenv/config";
import express from "express";
import session from "express-session";
import pgSession from "connect-pg-simple";
import pg from "pg";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);

const isProduction =
  process.env.NODE_ENV === "production" ||
  process.env.RENDER === "true";

const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: isProduction
        ? { rejectUnauthorized: false }
        : false
    })
  : null;

app.set("trust proxy", 1);

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
      crypto.randomBytes(32).toString("hex"),

    resave: false,
    saveUninitialized: false,
    proxy: true,

    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 7 * 86400000
    }
  })
);

/* =========================
   DATABASE
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

async function discord(pathname, options = {}) {
  const response = await fetch(
    "https://discord.com/api/v10" + pathname,
    {
      ...options,

      headers: {
        "User-Agent": "AetherDashboard/2.0",
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(
      "Discord API " + response.status
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

/* =========================
   PERMISSIONS
========================= */

function manageable(guild) {
  const permissions = BigInt(
    guild.permissions || "0"
  );

  return (
    !!guild.owner ||
    !!(permissions & (1n << 3n)) ||
    !!(permissions & (1n << 5n))
  );
}

/* =========================
   AUTH MIDDLEWARE
========================= */

function auth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      error: "Not authenticated"
    });
  }

  next();
}

async function guildAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      error: "Not authenticated"
    });
  }

  const guildId = String(
    req.params.guildId
  );

  const guild = (
    req.session.guilds || []
  ).find(
    guild => guild.id === guildId
  );

  if (!guild || !manageable(guild)) {
    return res.status(403).json({
      error:
        "You cannot manage this server."
    });
  }

  req.guild = guild;

  next();
}

/* =========================
   OAUTH
========================= */

function oauth() {
  return (
    "https://discord.com/oauth2/authorize?" +
    new URLSearchParams({
      client_id:
        process.env.DISCORD_OAUTH_CLIENT_ID ||
        process.env.DISCORD_CLIENT_ID ||
        "",

      redirect_uri:
        process.env.DISCORD_OAUTH_REDIRECT_URI ||
        "",

      response_type: "code",

      scope: "identify guilds"
    }).toString()
  );
}

/* =========================
   BOT GUILDS
========================= */

async function botGuilds() {
  if (!process.env.DISCORD_TOKEN) {
    return [];
  }

  try {
    return await discord(
      "/users/@me/guilds",
      {
        headers: {
          Authorization:
            "Bot " +
            process.env.DISCORD_TOKEN
        }
      }
    );
  } catch (error) {
    console.error(
      "Could not fetch bot guilds:",
      error
    );

    return [];
  }
}

/* =========================
   DEFAULT SETTINGS
========================= */

const defaults = {
  volume: 80,
  maxQueue: 100,
  autoplay: false,
  twentyFourSeven: false,
  repeat: "off",

  djRoleId: "",
  musicChannelId: "",
  logChannelId: "",

  embedColor: "#8b5cf6",

  nowPlayingTitle:
    "Now Playing",

  footerText:
    "Aether Music",

  language: "en",

  announceNowPlaying: true,
  deleteCommands: false,
  allowExternalLinks: true,

  sourceYouTube: true,
  sourceSoundCloud: true,
  sourceSpotify: true,
  sourceAppleMusic: true,
  sourceDeezer: true,
  sourceBandcamp: true,
  sourceTwitch: true,
  sourceVimeo: true,
  sourceRadio: true,
  sourceDirectUrl: true,

  requesterDisplay: true,
  showQueueButtons: true,

  allowPlaylists: true,
  allowSearch: true,

  defaultSearchSource:
    "youtube",

  minDjRole: false,

  logCommands: true,
  logPlayer: true,
  logJoins: true,

  enableAnalytics: true
};

/* =========================
   LOGIN
========================= */

app.get(
  "/auth/discord",
  (_, res) => {
    res.redirect(oauth());
  }
);

/* =========================
   OAUTH CALLBACK
========================= */

app.get(
  "/auth/discord/callback",
  async (req, res) => {
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
            process.env.DISCORD_OAUTH_CLIENT_ID ||
            process.env.DISCORD_CLIENT_ID ||
            "",

          client_secret:
            process.env
              .DISCORD_OAUTH_CLIENT_SECRET ||
            "",

          grant_type:
            "authorization_code",

          code: String(
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
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },

            body
          }
        );

      if (!tokenResponse.ok) {
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

      if (!token.access_token) {
        throw new Error(
          "Discord did not return an access token"
        );
      }

      const [user, guilds] =
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
        id: user.id,

        username:
          user.global_name ||
          user.username,

        avatar:
          user.avatar || null
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
    } catch (error) {
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
  (req, res) => {
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
   CURRENT USER
========================= */

app.get(
  "/api/me",
  auth,
  async (req, res) => {
    const botGuildList =
      await botGuilds();

    const botGuildIds =
      new Set(
        botGuildList.map(
          guild => guild.id
        )
      );

    res.json({
      user:
        req.session.user,

      guilds: (
        req.session.guilds ||
        []
      ).map(guild => ({
        ...guild,

        botInstalled:
          botGuildIds.has(
            guild.id
          )
      }))
    });
  }
);

/* =========================
   GUILD META
========================= */

app.get(
  "/api/guilds/:guildId/meta",
  guildAuth,
  async (req, res) => {
    const guildId =
      req.guild.id;

    const botGuildList =
      await botGuilds();

    const installed =
      botGuildList.some(
        guild =>
          guild.id === guildId
      );

    let roles = [];
    let channels = [];

    if (
      installed &&
      process.env.DISCORD_TOKEN
    ) {
      try {
        [
          roles,
          channels
        ] = await Promise.all([
          discord(
            `/guilds/${guildId}/roles`,
            {
              headers: {
                Authorization:
                  "Bot " +
                  process.env.DISCORD_TOKEN
              }
            }
          ),

          discord(
            `/guilds/${guildId}/channels`,
            {
              headers: {
                Authorization:
                  "Bot " +
                  process.env.DISCORD_TOKEN
              }
            }
          )
        ]);
      } catch (error) {
        console.error(
          "Guild metadata error:",
          error
        );
      }
    }

    res.json({
      guild: req.guild,

      installed,

      roles:
        roles.filter(
          role =>
            !role.managed
        ),

      channels:
        channels.filter(
          channel =>
            channel.type === 0 ||
            channel.type === 2
        )
    });
  }
);

/* =========================
   SETTINGS GET
========================= */

app.get(
  "/api/guilds/:guildId/settings",
  guildAuth,
  async (req, res) => {
    const result =
      await db(
        `
        SELECT config
        FROM guild_settings
        WHERE guild_id=$1
        `,
        [req.guild.id]
      );

    res.json({
      ...defaults,

      ...(result.rows[0]?.config ||
        {})
    });
  }
);

/* =========================
   SETTINGS UPDATE
========================= */

app.put(
  "/api/guilds/:guildId/settings",
  guildAuth,
  async (req, res) => {
    const config = {};

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
      ok: true,

      settings: {
        ...defaults,
        ...config
      }
    });
  }
);

/* =========================
   PLAYER STATE
========================= */

app.get(
  "/api/guilds/:guildId/player",
  guildAuth,
  async (req, res) => {
    const result =
      await db(
        `
        SELECT state
        FROM player_state
        WHERE guild_id=$1
        `,
        [req.guild.id]
      );

    res.json(
      result.rows[0]?.state ||
        {
          connected: false,
          playing: false,
          track: null,
          queue: [],
          volume: 80,
          repeat: "off"
        }
    );
  }
);

/* =========================
   PLAYER COMMANDS
========================= */

app.post(
  "/api/guilds/:guildId/player/:command",
  guildAuth,
  async (req, res) => {
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

    if (
      !allowed.includes(
        req.params.command
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            "Unknown player command"
        });
    }

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
        req.params.command,
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
          req.params.command,
        payload
      ]
    );

    res.json({
      ok: true,
      queued: true
    });
  }
);

/* =========================
   ANALYTICS
========================= */

app.get(
  "/api/guilds/:guildId/analytics",
  guildAuth,
  async (req, res) => {
    const days =
      Math.min(
        90,
        Math.max(
          1,
          Number(
            req.query.days ||
              30
          )
        )
      );

    const result =
      await db(
        `
        SELECT
          event_type,
          COUNT(*)::int count
        FROM analytics_events
        WHERE guild_id=$1
          AND created_at >
            NOW() -
            ($2 || ' days')::interval
        GROUP BY event_type
        ORDER BY count DESC
        `,
        [
          req.guild.id,
          String(days)
        ]
      );

    res.json({
      days,
      events:
        result.rows
    });
  }
);

/* =========================
   AUDIT LOG
========================= */

app.get(
  "/api/guilds/:guildId/audit",
  guildAuth,
  async (req, res) => {
    const result =
      await db(
        `
        SELECT
          user_id,
          action,
          payload,
          created_at
        FROM audit_log
        WHERE guild_id=$1
        ORDER BY id DESC
        LIMIT 100
        `,
        [req.guild.id]
      );

    res.json(
      result.rows
    );
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

app.get(
  "/",
  (_, res) => {
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
  (error, req, res, next) => {
    console.error(
      "Unhandled server error:",
      error
    );

    if (
      res.headersSent
    ) {
      return next(error);
    }

    res
      .status(500)
      .json({
        error:
          "Internal server error"
      });
  }
);

/* =========================
   START SERVER
========================= */

initializeDatabase()
  .then(() => {
    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `Aether Dashboard 2.0 listening on port ${PORT}`
        );

        console.log(
          "Production mode:",
          isProduction
        );

        console.log(
          "Database configured:",
          !!process.env
            .DATABASE_URL
        );

        console.log(
          "OAuth redirect:",
          process.env
            .DISCORD_OAUTH_REDIRECT_URI
        );
      }
    );
  })
  .catch(error => {
    console.error(
      "Failed to initialize Aether database:",
      error
    );

    process.exit(1);
  });
