import { SlashCommandBuilder } from 'discord.js';
import { getExistingPlayer, fail } from '../player/requirePlayer.js';
export const data=new SlashCommandBuilder().setName('remove').setDescription('Remove a track from the queue').addIntegerOption(o=>o.setName('position').setDescription('Queue position').setMinValue(1).setRequired(true));
export async function execute(i){const p=getExistingPlayer(i);if(!p)return fail(i,'Queue is empty.');const n=i.options.getInteger('position',true)-1;if(n<0||n>=p.tracks.length)return fail(i,'That queue position does not exist.');const [t]=p.tracks.splice(n,1);await p.refreshControls();return i.reply({content:`🗑️ Removed **${t.title}**.`,ephemeral:true});}
