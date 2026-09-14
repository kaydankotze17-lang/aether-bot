import { SlashCommandBuilder } from "discord.js";
import { fail, requireSameVoice } from "../player/requirePlayer.js";

export const data = new SlashCommandBuilder()
  .setName("skip")
  .setDescription("Skip the current track");

export async function execute(interaction) {
  const check = requireSameVoice(interaction);
  if (check.error) return fail(interaction, check.error);
  if (!check.player) return fail(interaction, "Nothing is playing.");

  const message = check.player.skip();
  await interaction.reply({ content: message });
}
