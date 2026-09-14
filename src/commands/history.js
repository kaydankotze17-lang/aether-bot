import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getExistingPlayer, fail } from '../player/requirePlayer.js';
export const data=new SlashCommandBuilder().setName('history').setDescription('Show recently played tracks');
export async function execute(i){const p=getExistingPlayer(i);if(!p||!p.history.length)return fail(i,'Playback history is empty.');const e=new EmbedBuilder().setColor(0x8b5cf6).setAuthor({name:'AETHER • HISTORY'}).setTitle('🕘 Recently Played').setDescription(p.history.slice(-10).reverse().map((t,n)=>`**${n+1}.** ${t.title} — ${t.artist||'Unknown'}`).join('\n'));return i.reply({embeds:[e]});}
