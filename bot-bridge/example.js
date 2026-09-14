import 'dotenv/config';
import { createAetherDashboardBridge, publishPlayerState, publishAnalytics } from './bridge.js';

// Put this inside your existing Aether bot after it logs in.
// The dashboard and bot use the SAME Railway PostgreSQL DATABASE_URL.
const bridge = createAetherDashboardBridge({
  databaseUrl: process.env.DATABASE_URL,
  onCommand: async ({ guildId, command, payload }) => {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { ok:false, error:'Bot is not in this guild' };

    // Replace these calls with your existing GuildPlayer/music manager.
    switch (command) {
      case 'join': return { ok:true, action:'join', guildId };
      case 'play': return { ok:true, action:'play', query:payload.query||'' };
      case 'pause': return { ok:true, action:'pause' };
      case 'resume': return { ok:true, action:'resume' };
      case 'skip': return { ok:true, action:'skip' };
      case 'stop': return { ok:true, action:'stop' };
      case 'shuffle': return { ok:true, action:'shuffle' };
      case 'previous': return { ok:true, action:'previous' };
      case 'disconnect': return { ok:true, action:'disconnect' };
      case 'volume': return { ok:true, action:'volume', value:Number(payload.value) };
      case 'repeat': return { ok:true, action:'repeat', value:payload.value };
      case 'clear': return { ok:true, action:'clear' };
      default: return { ok:false, error:'Unsupported command' };
    }
  }
});

// Example heartbeat/event calls:
// await publishPlayerState(process.env.DATABASE_URL, guild.id, { connected:true, playing:true, track:{title:'Song',url:'...'}, queue:[], volume:80, repeat:'off' });
// await publishAnalytics(process.env.DATABASE_URL, guild.id, 'song_played', { title:'Song' });

process.on('SIGINT', async()=>{ await bridge.stop(); process.exit(0); });
