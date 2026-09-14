import { SlashCommandBuilder } from 'discord.js';
import { resolveQuery } from '../sources/index.js';
import { requireJoinableVoice } from '../player/requirePlayer.js';
export const data=new SlashCommandBuilder().setName('playnext').setDescription('Put a track at the front of the queue').addStringOption(o=>o.setName('query').setDescription('Song or URL').setRequired(true));
export async function execute(i,{client}){const j=requireJoinableVoice(i,client);if(j.error)return i.reply({content:j.error,ephemeral:true});await i.deferReply({ephemeral:true});const tracks=await resolveQuery(i.options.getString('query',true),i);if(!tracks.length)return i.editReply('Nothing playable found.');const p=(await import('../player/PlayerManager.js')).playerManager.get(i.guild);p.textChannel=i.channel;p.connect(j.channel);p.tracks.unshift(...tracks.reverse());if(!p.current)await p.playCurrent();await p.refreshControls();return i.editReply(`⏭️ Added **${tracks[tracks.length-1].title}** to play next.`);}
