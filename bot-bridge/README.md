# Aether Bot <-> Dashboard bridge

The dashboard and bot communicate through the same PostgreSQL database.

## Railway

Use one Railway PostgreSQL service and set the same `DATABASE_URL` variable on both the dashboard service and the bot service.

## Integration

Copy `bridge.js` into your bot or import it from this folder. Start `createAetherDashboardBridge()` after the bot has logged in. In the `onCommand` callback, connect each command to your existing `GuildPlayer`/music manager.

The dashboard queues commands in `bot_commands`. The bridge claims them with `FOR UPDATE SKIP LOCKED`, executes them, and records the result.

The bot should also call `publishPlayerState()` whenever the player changes so the dashboard can show live server-specific state.

Do not put the Discord bot token in the dashboard frontend. The dashboard only uses it server-side for Discord API checks.
