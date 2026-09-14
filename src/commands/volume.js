import { SlashCommandBuilder } from "discord.js";
import { fail, requireSameVoice } from "../player/requirePlayer.js";

export const data = new SlashCommandBuilder()
  .setName("volume")
  .setDescription("Set playback volume from 0 to 100")
  .addIntegerOption((option) =>
    option
      .setName("level")
      .setDescription("Volume percent (0-100)")
      .setRequired(true)
      .setMinValue(0)
      .setMaxValue(100),
  );

export async function execute(interaction) {
  const check = requireSameVoice(interaction);
  if (check.error) return fail(interaction, check.error);
  if (!check.player) return fail(interaction, "Start playback with /play first.");

  const level = interaction.options.getInteger("level", true);
  const message = check.player.setVolume(level);
  await interaction.reply({ content: message });
  await check.player.refreshControls();
}
