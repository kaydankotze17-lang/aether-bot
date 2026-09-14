import { SlashCommandBuilder } from "discord.js";
import { fail, requireSameVoice } from "../player/requirePlayer.js";

export const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Stop playback and clear the queue");

export async function execute(interaction) {
  const check = requireSameVoice(interaction);
  if (check.error) return fail(interaction, check.error);
  if (!check.player) return fail(interaction, "Nothing is playing.");

  const message = check.player.stop();
  await interaction.reply({ content: message });
  await check.player.refreshControls();
}
