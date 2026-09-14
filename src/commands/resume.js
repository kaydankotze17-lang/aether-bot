import { SlashCommandBuilder } from "discord.js";
import { fail, requireSameVoice } from "../player/requirePlayer.js";

export const data = new SlashCommandBuilder()
  .setName("resume")
  .setDescription("Resume paused playback");

export async function execute(interaction) {
  const check = requireSameVoice(interaction);
  if (check.error) return fail(interaction, check.error);
  if (!check.player?.current) return fail(interaction, "Nothing is paused.");

  const message = check.player.resume();
  await interaction.reply({ content: message });
  await check.player.refreshControls();
}
