import { SlashCommandBuilder } from "discord.js";
import { resolveQuery, sourceLabel } from "../sources/index.js";
import { playerManager } from "../player/PlayerManager.js";
import { requireJoinableVoice } from "../player/requirePlayer.js";
import { logger } from "../logger.js";
import { truncate } from "../util/format.js";
import { ephemeral, safeReply, safeEdit } from "../util/voice.js";

export const data = new SlashCommandBuilder()
  .setName("play")
  .setDescription("Play Spotify, YouTube, SoundCloud, MusicBrainz, radio, archive or any song")
  .addStringOption((option) =>
    option
      .setName("query")
      .setDescription("Spotify / YouTube / SoundCloud / MusicBrainz / song name / radio / URL")
      .setRequired(true),
  );

export async function execute(interaction, { client }) {
  // ALWAYS acknowledge within 3s so Discord doesn't show "application did not respond"
  try {
    await interaction.deferReply();
  } catch (err) {
    logger.error("deferReply failed:", err);
    return;
  }

  const joined = requireJoinableVoice(interaction, client);
  if (joined.error) {
    return safeEdit(interaction, { content: joined.error });
  }

  const query = interaction.options.getString("query", true);

  let tracks;
  try {
    tracks = await Promise.race([
      resolveQuery(query, interaction),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Music search timed out. Please try again.")), 30_000),
      ),
    ]);
  } catch (error) {
    logger.warn("Resolve failed:", error?.message || error);
    return safeEdit(interaction, {
      content: error?.message || "Could not find anything for that query.",
    });
  }

  if (!tracks?.length) {
    return safeEdit(interaction, { content: "Nothing playable was found." });
  }

  const player = playerManager.get(interaction.guild);
  const wasIdle = !player.current && !player.isPlaying();

  try {
    const added = await player.enqueue(tracks, {
      interaction,
      channel: joined.channel,
    });

    if (wasIdle) {
      // refreshControls will edit the deferred reply into the now-playing embed
      await player.refreshControls(interaction);
      return;
    }

    const summary = added
      .slice(0, 3)
      .map((track) => `**${truncate(track.title, 80)}** (${sourceLabel(track.source)})`)
      .join("\n");
    const extra = added.length > 3 ? `\n...and ${added.length - 3} more` : "";
    await safeEdit(interaction, {
      content: `Added to queue:\n${summary}${extra}`,
    });
    await player.refreshControls();
  } catch (error) {
    logger.error("Play failed:", error);
    await safeEdit(interaction, {
      content: `Could not start playback. ${error?.message || "Unknown error"}`,
    });
  }
}
