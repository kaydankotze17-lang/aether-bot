import { SlashCommandBuilder } from "discord.js";
import { fail, requireSameVoice } from "../player/requirePlayer.js";

export const data = new SlashCommandBuilder()
  .setName("shuffle")
  .setDescription("Shuffle the upcoming tracks");

export async function execute(interaction) {
  const check = requireSameVoice(interaction);
  if (check.error) return fail(interaction, check.error);
  if (!check.player) return fail(interaction, "The queue is empty.");

  const message = check.player.shuffle();
  await interaction.reply({ content: message });
}
