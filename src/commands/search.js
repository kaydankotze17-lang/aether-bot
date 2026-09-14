import { SlashCommandBuilder } from "discord.js";
import { searchYouTube, searchSoundCloud, searchMusicBrainz, searchAudius } from "../sources/index.js";
import { playerManager } from "../player/PlayerManager.js";
import { requireJoinableVoice } from "../player/requirePlayer.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { ephemeral, safeEdit } from "../util/voice.js";

export const data = new SlashCommandBuilder()
  .setName("search")
  .setDescription("Search for music and choose a result")
  .addStringOption((o) => o.setName("query").setDescription("Song, artist or title").setRequired(true));

export async function execute(interaction, { client }) {
  const joined = requireJoinableVoice(interaction, client);
  if (joined.error) return interaction.reply(ephemeral(joined.error));
  await interaction.deferReply();
  const query = interaction.options.getString("query", true);
  const requestedBy = { id: interaction.user.id, tag: interaction.user.username };
  const sources = [searchYouTube, searchSoundCloud, searchMusicBrainz, searchAudius];
  let results = [];
  for (const search of sources) {
    try { results.push(...(await search(query, requestedBy))); } catch {}
    if (results.length >= 8) break;
  }
  results = results.slice(0, 8);
  if (!results.length) return safeEdit(interaction, { content: `No results found for **${query}**.` });

  const embed = new EmbedBuilder().setColor(0x8b5cf6).setTitle("🔎 AETHER SEARCH").setDescription(`Results for **${query}**\nSelect a track below.`);
  embed.addFields(results.map((track, i) => ({ name: `${i + 1}. ${track.title}`, value: `${track.artist || "Unknown artist"} • ${track.source}`, inline: false })));
  const rows = [];
  for (let i = 0; i < results.length; i += 4) {
    const row = new ActionRowBuilder();
    results.slice(i, i + 4).forEach((_, j) => row.addComponents(new ButtonBuilder().setCustomId(`aether:search:${i + j}`).setLabel(String(i + j + 1)).setStyle(ButtonStyle.Primary)));
    rows.push(row);
  }
  const player = playerManager.get(interaction.guild);
  player.searchResults = results;
  player.textChannel = interaction.channel ?? player.textChannel;
  await interaction.editReply({ embeds: [embed], components: rows });
}
