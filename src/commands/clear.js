import { SlashCommandBuilder } from 'discord.js';
import { getExistingPlayer, fail } from '../player/requirePlayer.js';
export const data=new SlashCommandBuilder().setName('clear').setDescription('Clear upcoming tracks without stopping the current song');
export async function execute(i){const p=getExistingPlayer(i);if(!p)return fail(i,'Queue is empty.');const n=p.tracks.length;p.tracks=[];await p.refreshControls();return i.reply({content:`🧹 Cleared **${n}** upcoming tracks.`,ephemeral:true});}
