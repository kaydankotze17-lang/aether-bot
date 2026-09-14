import { SlashCommandBuilder } from 'discord.js';
import { getExistingPlayer, fail } from '../player/requirePlayer.js';
export const data=new SlashCommandBuilder().setName('timer').setDescription('Set or cancel a sleep timer').addIntegerOption(o=>o.setName('minutes').setDescription('Minutes, 0 cancels').setMinValue(0).setMaxValue(1440).setRequired(true));
export async function execute(i){const p=getExistingPlayer(i);if(!p)return fail(i,'Nothing is playing.');const m=i.options.getInteger('minutes',true);p.setSleepTimer?.(m);return i.reply({content:m?`⏱️ Sleep timer set for **${m} minutes**.`:'⏱️ Sleep timer cancelled.',ephemeral:true});}
