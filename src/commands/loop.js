import { SlashCommandBuilder } from "discord.js";
import { fail, requireSameVoice } from "../player/requirePlayer.js";

export const data = new SlashCommandBuilder()
  .setName("loop")
  .setDescription("Set loop mode for this server")
  .addStringOption((option) =>
    option
      .setName("mode")
      .setDescription("Loop mode")
      .setRequired(true)
      .addChoices(
        { name: "Off", value: "off" },
        { name: "Track", value: "track" },
        { name: "Queue", value: "queue" },
      ),
  );

export async function execute(interaction) {
  const check = requireSameVoice(interaction);
  if (check.error) return fail(interaction, check.error);
  if (!check.player) return fail(interaction, "Start playback with /play first.");

  const mode = interaction.options.getString("mode", true);
  const message = check.player.setLoop(mode);
  await interaction.reply({ content: message });
  await check.player.refreshControls();
}
