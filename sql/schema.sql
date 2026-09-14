CREATE TABLE IF NOT EXISTS guild_settings (guild_id TEXT PRIMARY KEY, guild_name TEXT NOT NULL DEFAULT '', config JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS player_state (guild_id TEXT PRIMARY KEY, state JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS bot_commands (id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL, command TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), claimed_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, result JSONB);
CREATE INDEX IF NOT EXISTS bot_commands_pending_idx ON bot_commands(guild_id, completed_at, claimed_at, id);
CREATE TABLE IF NOT EXISTS analytics_events (id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL, event_type TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS analytics_events_guild_idx ON analytics_events(guild_id, created_at DESC);
CREATE TABLE IF NOT EXISTS audit_log (id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, action TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS audit_log_guild_idx ON audit_log(guild_id, created_at DESC);
