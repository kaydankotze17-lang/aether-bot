# Aether Discord Music Bot

A complete Discord music bot you can deploy from a phone. No Termux, no Android Studio, no local computer.

It uses **Discord slash commands**, a **per-server queue**, **live Spotify-style progress bar**, **real-time synced lyrics**, and a **now-playing message with buttons**:

`Previous | Pause | Resume | Skip | Stop`

Secrets stay in environment variables. Nothing in this project contains a real token.

## What it can play (and what it cannot)

This bot now includes **YouTube support** (via play-dl) so modern songs work. Still has Audius, Radio Browser, Internet Archive and direct URLs.

| You type | What happens |
| --- | --- |
| `/play modern song name` | **YouTube first** — searches & streams the top result so current tracks work. |
| `/play https://youtube.com/...` or playlist | Resolves the video or up to 50 playlist tracks. |
| `/play yt <query>` | Force YouTube search. |
| `/play radio lofi` | Searches [Radio Browser](https://www.radio-browser.info) for a live station. |
| `/play archive miles davis` | Searches [Internet Archive](https://archive.org) public audio. |
| `/play https://example.com/song.mp3` | Plays a direct audio file or stream. |
| Audius / archive.org page URL | Resolves through official APIs. |

YouTube is now unlocked for modern tracks. Use normal song names or paste YouTube links/playlists. Note: unofficial extractors can break or face rate limits — keep a backup of the original sources.

## Commands

| Command | What it does |
| --- | --- |
| `/play query` | Join your voice channel, resolve the query, and play or queue it. |
| `/pause` | Pause the current track. |
| `/resume` | Resume paused playback. |
| `/skip` | Skip to the next queued track. |
| `/stop` | Stop playback and clear the queue. Stay in the channel. |
| `/queue` | Show the current track and upcoming tracks. |
| `/volume level` | Set volume from 0 to 100. |
| `/loop mode` | `off`, `track`, or `queue`. |
| `/shuffle` | Shuffle upcoming tracks. |
| `/join` | Join your voice channel without starting a track. |
| `/leave` | Disconnect and clear the queue. |
| `/nowplaying` | Re-open the live Aether player. |
| `/history` | Show recently played tracks. |
| `/remove position` | Remove a queued track. |
| `/move from to` | Reorder the queue. |
| `/clear` | Clear upcoming tracks. |
| `/playnext query` | Put a track at the front of the queue. |
| `/timer minutes` | Stop playback after a timer. |
| `/settings` | Configure autoplay, 24/7 mode and DJ role. |

The now-playing message has the same Previous / Pause / Resume / Skip / Stop controls. The new queue tools support remove/reorder/play-next/history, and server settings persist to `data/settings.json`. You must be in the same voice channel as the bot to use them.

Playback continues to the next queued track automatically. Loop track repeats the current item. Loop queue sends finished tracks to the end of the list.

## Requirements

- Node.js **22.12 or newer** (the host image in the Dockerfile is Node 22)
- A Discord application with a bot user
- A host that can run a **long-lived Node process** (not a serverless platform)
- FFmpeg (installed in the Dockerfile; `ffmpeg-static` is also bundled as a fallback)

**Do not deploy this bot to Vercel, Netlify, or Cloudflare Workers.** Those platforms sleep or kill WebSocket connections. Discord voice needs a process that stays online.

Use **Railway** (recommended from a phone) or **Render**.

---

## Deploy from a phone (Railway)

You only need Chrome or Firefox, the Discord app, GitHub, and Railway. All of these have mobile websites.

### 1. Create the Discord bot

1. On your phone, open [https://discord.com/developers/applications](https://discord.com/developers/applications) and sign in.
2. Tap **New Application**, name it `Aether`, and create it.
3. Open **Bot**.
4. Disable **Public Bot** if you only want it on your server (optional).
5. Leave **Privileged Gateway Intents** off. This bot does not need them.
6. Tap **Reset Token**, confirm, and copy the token. Store it in your notes app. This is `DISCORD_TOKEN`.
7. Open **General Information** and copy the **Application ID**. This is `CLIENT_ID`.
8. Open **OAuth2** then **URL Generator**.
9. Under **Scopes**, enable `bot` and `applications.commands`.
10. Under **Bot Permissions**, enable:
    - View Channels
    - Send Messages
    - Embed Links
    - Connect
    - Speak
11. Copy the generated URL, open it, pick your server, and authorize.

### 2. Get your server ID (optional, recommended)

This makes slash commands appear in a few seconds instead of up to an hour.

1. In the Discord app, open **User Settings -> Advanced** and enable **Developer Mode**.
2. Long-press your server name -> **Copy Server ID**.
3. That value is `GUILD_ID`.

After the first successful deploy you can delete `GUILD_ID` so commands register globally.

### 3. Put the project on GitHub

1. Download `aether-discord-music-bot.zip` from the Aether page, or use the files in this folder.
2. Unzip it with your phone's Files app. You should see `package.json`, `Dockerfile`, `src`, and `.env.example`.
3. Open [https://github.com/new](https://github.com/new) on mobile, sign in, create a **private** repository named `aether-discord-music-bot`. Do not add a README.
4. On the empty repo page, tap **uploading an existing file**.
5. Upload **everything inside** the unzipped folder, including `src` (upload the `src` directory, not only the top-level files). Keep hidden files: `.env.example`, `.gitignore`, `.nvmrc`, `Dockerfile`.
6. Commit.

If GitHub's mobile uploader skips hidden files, that is OK as long as `package.json`, `Dockerfile`, and the whole `src` folder are present. `.gitignore` and `.env.example` are still in this README if you need to recreate them.

### 4. Deploy on Railway

1. Open [https://railway.app](https://railway.app) and sign in with GitHub.
2. **New Project** -> **Deploy from GitHub repo** -> select `aether-discord-music-bot`.
3. Railway will detect the Dockerfile and build Node 22 + FFmpeg.
4. Open the service -> **Variables** and add:

```
DISCORD_TOKEN=your-bot-token
CLIENT_ID=your-application-id
GUILD_ID=your-server-id
```

Leave `GUILD_ID` empty if you want global commands.

5. Deploy / wait until the service is online.
6. Open the service logs. You should see:
   - `DAVE voice encryption library loaded.`
   - `Logged in as YourBot#1234`
   - `Registered 11 guild slash commands` (or global commands)

### 5. Test in Discord

1. Join a voice channel on your phone.
2. Type `/play radio lofi`.
3. The bot should join, start the station, and post a now-playing message with buttons.

If slash commands are missing, wait a minute, fully close and reopen Discord, or confirm `CLIENT_ID` and that the invite included `applications.commands`.

---

## Deploy from a phone (Render)

1. Complete Discord and GitHub steps above.
2. Open [https://dashboard.render.com](https://dashboard.render.com) and sign in with GitHub.
3. **New +** -> **Web Service** -> pick the repo.
4. Runtime: **Docker**.
5. Add the same environment variables: `DISCORD_TOKEN`, `CLIENT_ID`, optional `GUILD_ID`.
6. Create the service.

Render free web services sleep after idle time, which drops Discord voice. Use a paid instance that stays awake.

## Environment variables

Copy `.env.example`. Never commit a real `.env` file.

```
DISCORD_TOKEN=
CLIENT_ID=
GUILD_ID=
```

| Name | Required | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Bot login token |
| `CLIENT_ID` | Yes | Application ID used to register slash commands |
| `GUILD_ID` | No | Instant guild command registration while you are testing |
| `PORT` | No | Health-check port. Railway and Render set this automatically. |

There is a tiny HTTP server on `PORT` (default 3000) at `/health` so hosts that expect a web process stay green. It does not play music. Music goes through Discord voice.

## Project structure

```
aether-discord-music-bot/
  package.json
  package-lock.json
  .env.example
  .gitignore
  .nvmrc
  Dockerfile
  railway.toml
  render.yaml
  nixpacks.toml
  Procfile
  LICENSE
  README.md
  src/
    index.js                 Bot entry point
    config.js                Environment variables
    logger.js                Timestamped logs (no emoji)
    health.js                /health HTTP server
    registerCommands.js      Slash command registration
    commands/                One file per slash command
    events/                  ready, interactions, voice state
    player/                  Per-server queue, buttons, reconnect
    sources/                 Audius, Radio Browser, Archive, URLs
    util/                    HTTP, formatting, voice helpers
```

## How the player works

- Each Discord server has its own `GuildPlayer` (queue, loop, volume, voice connection).
- `/play` resolves the query, joins your voice channel, and either starts playback or appends to the queue.
- When a track ends, the bot plays the next item. Errors skip the failed item instead of crashing.
- If Discord drops the voice WebSocket, the bot tries to reconnect (up to five times) and resume.
- If the voice channel stays empty of humans for five minutes, the bot leaves.
- Volume uses FFmpeg inline volume so `/volume` applies immediately.

## Hosting limitations

| Platform | Use it? | Why |
| --- | --- | --- |
| Railway | Yes | Persistent process, Dockerfile, env UI works on phones |
| Render (always-on) | Yes | Same as Railway if it does not sleep |
| A VPS with Docker | Yes | Run `docker build` and `docker run` |
| Vercel / Netlify | No | Serverless. Discord bots and voice will die |
| Cloudflare Workers | No | No persistent voice WebSocket |

## Local run (optional, computer only)

You asked not to use a local Android setup. This section is only if you later use a computer.

```bash
cp .env.example .env
# paste DISCORD_TOKEN and CLIENT_ID
npm install
npm start
```

Node 22.12+ is required (`@discordjs/voice` 0.19).

## Dependencies (pinned to current supported releases)

- `discord.js` ^14.27.0
- `@discordjs/voice` ^0.19.2
- `@snazzah/davey` ^0.1.12 (required in 2026; Discord voice uses DAVE encryption and rejects connections with close code 4017 without it)
- `opusscript` ^0.1.1 (pure-JS Opus, no native compiler needed)
- `ffmpeg-static` ^5.3.0 (audio decode/transcode fallback)
- `dotenv` ^17.4.2

The Dockerfile also installs system `ffmpeg`.

## License

MIT


## Aether Web Dashboard

A lightweight mobile-friendly dashboard is available at `/dashboard`. Set `DASHBOARD_TOKEN` before exposing it publicly. The dashboard shows active guild players and provides pause/resume/skip/previous/shuffle/stop controls.


## v1.2 features
- Automatic multi-source playback failover when a source errors or returns 429.
- `/favorites add|list|play|remove|clear` with up to 50 saved tracks per user.
- `/lyrics` command for the current track.
- Source search timeouts to prevent stuck playback attempts.
