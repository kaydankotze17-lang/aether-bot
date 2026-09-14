import { SlashCommandBuilder } from "discord.js";
import { getExistingPlayer } from "../player/requirePlayer.js";
import { buildQueuePayload } from "../player/nowPlaying.js";
import { fail } from "../player/requirePlayer.js";

export const data = new SlashCommandBuilder()
  .setName("queue")
  .setDescription("Show the upcoming tracks for this server");

export async function execute(interaction) {
  const player = getExistingPlayer(interaction);
  if (!player || (!player.current && player.tracks.length === 0)) {
    return fail(interaction, "The queue is empty.");
  }
  await interaction.reply(buildQueuePayload(player));
}
