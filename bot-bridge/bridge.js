import pg from 'pg';

export function createAetherDashboardBridge({ databaseUrl, pollMs = 750, onCommand = async () => {} }) {
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
  let timer;
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await c.query(`SELECT id,guild_id,command,payload FROM bot_commands WHERE completed_at IS NULL AND claimed_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`);
        if (!r.rows.length) { await c.query('COMMIT'); return; }
        const row = r.rows[0];
        await c.query('UPDATE bot_commands SET claimed_at=NOW() WHERE id=$1',[row.id]);
        await c.query('COMMIT');
        try {
          const result = await onCommand({ id:row.id, guildId:row.guild_id, command:row.command, payload:row.payload });
          await pool.query('UPDATE bot_commands SET completed_at=NOW(),result=$2 WHERE id=$1',[row.id,result||{}]);
        } catch (err) {
          await pool.query('UPDATE bot_commands SET completed_at=NOW(),result=$2 WHERE id=$1',[row.id,{ok:false,error:String(err?.message||err)}]);
        }
      } finally { c.release(); }
    } finally { busy=false; }
  }
  timer=setInterval(tick,pollMs); tick();
  return { stop:async()=>{clearInterval(timer);await pool.end()} };
}

export async function publishPlayerState(databaseUrl, guildId, state) {
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized:false } : false });
  await pool.query(`INSERT INTO player_state(guild_id,state) VALUES($1,$2) ON CONFLICT(guild_id) DO UPDATE SET state=EXCLUDED.state,updated_at=NOW()`,[guildId,state]);
  await pool.end();
}

export async function publishAnalytics(databaseUrl, guildId, eventType, payload={}) {
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized:false } : false });
  await pool.query('INSERT INTO analytics_events(guild_id,event_type,payload) VALUES($1,$2,$3)',[guildId,eventType,payload]);
  await pool.end();
}
