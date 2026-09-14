import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getGuildSettings, updateGuildSettings } from '../configStore.js';
export const data = new SlashCommandBuilder().setName('settings').setDescription('Configure Aether for this server')
 .addSubcommand(s=>s.setName('show').setDescription('Show Aether settings'))
 .addSubcommand(s=>s.setName('autoplay').setDescription('Toggle autoplay').addBooleanOption(o=>o.setName('enabled').setDescription('Enabled').setRequired(true)))
 .addSubcommand(s=>s.setName('247').setDescription('Toggle 24/7 voice mode').addBooleanOption(o=>o.setName('enabled').setDescription('Enabled').setRequired(true)))
 .addSubcommand(s=>s.setName('dj').setDescription('Set the DJ role').addRoleOption(o=>o.setName('role').setDescription('Role').setRequired(false)))
 .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
export async function execute(interaction){
 const sub=interaction.options.getSubcommand(); const s=getGuildSettings(interaction.guildId);
 if(sub==='show') return interaction.reply({embeds:[new EmbedBuilder().setColor(0x8b5cf6).setAuthor({name:'AETHER • SETTINGS'}).setTitle('⚙️ Server Settings').addFields(
  {name:'🔀 Autoplay',value:s.autoplay?'ON':'OFF',inline:true},{name:'♾️ 24/7',value:s.stay247?'ON':'OFF',inline:true},{name:'🎧 DJ Role',value:s.djRoleId?`<@&${s.djRoleId}>`:'Everyone',inline:true},{name:'🔊 Default Volume',value:`${s.volume}%`,inline:true},{name:'📜 Max Queue',value:String(s.maxQueueSize),inline:true})]});
 if(sub==='autoplay') updateGuildSettings(interaction.guildId,{autoplay:interaction.options.getBoolean('enabled',true)});
 if(sub==='247') updateGuildSettings(interaction.guildId,{stay247:interaction.options.getBoolean('enabled',true)});
 if(sub==='dj') updateGuildSettings(interaction.guildId,{djRoleId:interaction.options.getRole('role')?.id||''});
 return interaction.reply({content:'✅ Aether settings updated.',ephemeral:true});
}
