# Aether Discord Dashboard 2.0

Full Railway-ready Discord OAuth dashboard with a real bot/dashboard communication layer.

## Included

- Discord OAuth2 login
- Manage-server permission verification
- Server picker restricted to manageable servers
- Bot-installed detection
- Discord roles/channels loaded from the server
- Server-scoped settings
- Music settings and source toggles
- Embed customization
- DJ role/music/log channel selection
- Player controls queued into PostgreSQL
- Live player-state storage
- Analytics event storage
- Audit log
- Shared PostgreSQL bot/dashboard bridge
- Mobile responsive UI
- Railway deployment files

## Railway variables

Dashboard:

DISCORD_TOKEN
DISCORD_CLIENT_ID
DISCORD_OAUTH_CLIENT_ID
DISCORD_OAUTH_CLIENT_SECRET
DISCORD_OAUTH_REDIRECT_URI
SESSION_SECRET
DATABASE_URL

Bot:

DATABASE_URL
DISCORD_TOKEN
DISCORD_CLIENT_ID

The OAuth redirect must exactly match the URL registered in the Discord Developer Portal.

## Bot connection

See `bot-bridge/README.md` and `bot-bridge/bridge.js`.

The dashboard does not try to control another server merely because a guild ID was typed into a request. Every dashboard route verifies the logged-in user's Discord guild permissions server-side.

## Important

This is the complete dashboard + communication foundation. Your existing Aether music manager still owns actual playback logic. The bridge is deliberately an adapter so your current music implementation can remain intact rather than being replaced by a second music engine.
