import { SlashCommandBuilder } from 'discord.js';
import { buildLyricsPayload } from '../player/nowPlaying.js';
import { getExistingPlayer, fail } from '../player/requirePlayer.js';
export const data = new SlashCommandBuilder().setName('lyrics').setDescription('Show lyrics for the current track');
export async function execute(interaction) {
  const player = getExistingPlayer(interaction);
  if (!player) return fail(interaction, 'Nothing is playing.');
  return interaction.reply(buildLyricsPayload(player));
}
