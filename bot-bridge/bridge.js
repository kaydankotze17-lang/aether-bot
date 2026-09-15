import pg from "pg";

export function createAetherDashboardBridge({
  databaseUrl,
  pollMs = 750,
  onCommand = async () => {}
}) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
  });

  let timer;
  let busy = false;

  async function tick() {
    if (busy) return;

    busy = true;

    try {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const result = await client.query(`
          SELECT
            id,
            guild_id,
            command,
            payload
          FROM bot_commands
          WHERE status = 'pending'
          ORDER BY id
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `);

        if (!result.rows.length) {
          await client.query("COMMIT");
          return;
        }

        const row = result.rows[0];

        await client.query(
          `
          UPDATE bot_commands
          SET status = 'processing'
          WHERE id = $1
          `,
          [row.id]
        );

        await client.query("COMMIT");

        try {
          const commandResult =
            await onCommand({
              id: row.id,
              guildId: row.guild_id,
              command: row.command,
              payload: row.payload
            });

          await pool.query(
            `
            UPDATE bot_commands
            SET
              status = 'completed',
              result = $2,
              processed_at = NOW()
            WHERE id = $1
            `,
            [
              row.id,
              commandResult || { ok: true }
            ]
          );
        } catch (error) {
          await pool.query(
            `
            UPDATE bot_commands
            SET
              status = 'failed',
              result = $2,
              processed_at = NOW()
            WHERE id = $1
            `,
            [
              row.id,
              {
                ok: false,
                error: String(
                  error?.message || error
                )
              }
            ]
          );
        }
      } finally {
        client.release();
      }
    } catch (error) {
      console.error(
        "[AETHER BRIDGE] Poll error:",
        error
      );
    } finally {
      busy = false;
    }
  }

  timer = setInterval(tick, pollMs);

  tick().catch(error => {
    console.error(
      "[AETHER BRIDGE] Initial poll error:",
      error
    );
  });

  return {
    stop: async () => {
      clearInterval(timer);
      await pool.end();
    }
  };
}

export async function publishPlayerState(
  databaseUrl,
  guildId,
  state
) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
  });

  await pool.query(
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
    [guildId, state]
  );

  await pool.end();
}

export async function publishAnalytics(
  databaseUrl,
  guildId,
  eventType,
  payload = {}
) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
  });

  await pool.query(
    `
    INSERT INTO analytics_events
      (guild_id, event_type, payload)
    VALUES
      ($1, $2, $3)
    `,
    [
      guildId,
      eventType,
      payload
    ]
  );

  await pool.end();
}
