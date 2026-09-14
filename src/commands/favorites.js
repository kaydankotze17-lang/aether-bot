import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { addFavorite, clearFavorites, listFavorites, removeFavorite } from '../favoritesStore.js';
import { getExistingPlayer, fail } from '../player/requirePlayer.js';
import { resolveQuery } from '../sources/index.js';
import { truncate, formatDuration } from '../util/format.js';

export const data = new SlashCommandBuilder()
  .setName('favorites')
  .setDescription('Save and play your favorite tracks')
  .addSubcommand((s) => s.setName('add').setDescription('Add the current track or a search result').addStringOption((o) => o.setName('query').setDescription('Song or URL (leave empty for current track)').setRequired(false)))
  .addSubcommand((s) => s.setName('list').setDescription('Show your saved tracks'))
  .addSubcommand((s) => s.setName('play').setDescription('Play a saved track').addIntegerOption((o) => o.setName('position').setDescription('Favorite number').setMinValue(1).setRequired(true)))
  .addSubcommand((s) => s.setName('remove').setDescription('Remove a saved track').addIntegerOption((o) => o.setName('position').setDescription('Favorite number').setMinValue(1).setRequired(true)))
  .addSubcommand((s) => s.setName('clear').setDescription('Delete all your favorites'));

export async function execute(interaction, { client }) {
  const sub = interaction.options.getSubcommand();
  const userId = interaction.user.id;
  const list = listFavorites(userId);

  if (sub === 'list') {
    if (!list.length) return interaction.reply('⭐ You have no favorites yet. Use `/favorites add` while a track is playing.');
    const e = new EmbedBuilder().setColor(0x8b5cf6).setAuthor({ name: 'AETHER • FAVORITES' }).setTitle('⭐ Your Favorites').setDescription(list.map((t, i) => `**${i + 1}.** ${truncate(t.title, 70)} — ${truncate(t.artist, 35)} • ${formatDuration(t.durationSec)}`).join('\n')).setFooter({ text: 'Use /favorites play position' });
    return interaction.reply({ embeds: [e] });
  }

  if (sub === 'remove') {
    const removed = removeFavorite(userId, interaction.options.getInteger('position', true));
    return interaction.reply(removed ? `🗑️ Removed **${removed.title}** from your favorites.` : 'That favorite number does not exist.');
  }

  if (sub === 'clear') {
    clearFavorites(userId);
    return interaction.reply('🗑️ Cleared your favorites.');
  }

  if (sub === 'add') {
    const query = interaction.options.getString('query');
    let track = null;
    if (query) {
      await interaction.deferReply({ ephemeral: true });
      try { track = (await resolveQuery(query, interaction))?.[0]; } catch (error) { return interaction.editReply(`Could not find that track. ${error.message}`); }
    } else {
      track = getExistingPlayer(interaction)?.current;
      if (!track) return interaction.reply({ content: 'Nothing is playing. Start a track or provide a query.', ephemeral: true });
    }
    const added = addFavorite(userId, track);
    const text = added ? `⭐ Saved **${track.title}** to your favorites.` : '⭐ That track is already in your favorites.';
    return query ? interaction.editReply(text) : interaction.reply({ content: text, ephemeral: true });
  }

  if (sub === 'play') {
    const track = list[interaction.options.getInteger('position', true) - 1];
    if (!track) return fail(interaction, 'That favorite number does not exist.');
    const { requireJoinableVoice } = await import('../player/requirePlayer.js');
    const joined = requireJoinableVoice(interaction, client);
    if (joined.error) return fail(interaction, joined.error);
    const { playerManager } = await import('../player/PlayerManager.js');
    const player = playerManager.get(interaction.guild);
    await player.enqueue([{ ...track, requestedBy: { id: interaction.user.id, tag: interaction.user.username } }], { interaction, channel: joined.channel });
    return interaction.reply(`▶️ Playing **${track.title}**.`);
  }
}
