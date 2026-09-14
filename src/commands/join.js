import { SlashCommandBuilder } from "discord.js";
import { entersState, VoiceConnectionStatus } from "@discordjs/voice";
import { playerManager } from "../player/PlayerManager.js";
import { fail, requireJoinableVoice } from "../player/requirePlayer.js";

export const data = new SlashCommandBuilder()
  .setName("join")
  .setDescription("Join your voice channel");

export async function execute(interaction, { client }) {
  const joined = requireJoinableVoice(interaction, client);
  if (joined.error) return fail(interaction, joined.error);

  const player = playerManager.get(interaction.guild);
  player.textChannel = interaction.channel ?? player.textChannel;
  player.connect(joined.channel);

  try {
    await entersState(player.connection, VoiceConnectionStatus.Ready, 15_000);
  } catch (error) {
    return interaction.reply({
      content: `Could not connect to voice. ${error.message}`,
    });
  }

  await interaction.reply({ content: `Joined **${joined.channel.name}**.` });
}
