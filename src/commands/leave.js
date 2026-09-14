import { SlashCommandBuilder } from "discord.js";
import { fail, getExistingPlayer, requireSameVoice } from "../player/requirePlayer.js";
import { playerManager } from "../player/PlayerManager.js";

export const data = new SlashCommandBuilder()
  .setName("leave")
  .setDescription("Leave the voice channel and clear the queue");

export async function execute(interaction) {
  const existing = getExistingPlayer(interaction);
  if (!existing || !existing.connection) {
    return fail(interaction, "I am not in a voice channel.");
  }

  const check = requireSameVoice(interaction);
  if (check.error) return fail(interaction, check.error);

  const message = existing.leave("Left the voice channel and cleared the queue.");
  playerManager.delete(interaction.guildId);
  await interaction.reply({ content: message });
}
