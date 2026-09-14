import { SlashCommandBuilder } from 'discord.js';
import { getExistingPlayer, fail } from '../player/requirePlayer.js';
import { buildNowPlayingPayload } from '../player/nowPlaying.js';
export const data=new SlashCommandBuilder().setName('nowplaying').setDescription('Show the Aether music player');
export async function execute(interaction){ const p=getExistingPlayer(interaction); if(!p||!p.current)return fail(interaction,'Nothing is playing.'); return interaction.reply(buildNowPlayingPayload(p)); }
