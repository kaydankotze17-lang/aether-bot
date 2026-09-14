import { playerManager } from "./PlayerManager.js";
import { botCanSpeak, ephemeral, getMemberVoiceChannel, safeReply } from "../util/voice.js";

export function getExistingPlayer(interaction) {
  return playerManager.peek(interaction.guildId);
}

export function requireSameVoice(interaction) {
  const channel = getMemberVoiceChannel(interaction);
  if (!channel) {
    return { error: "Join a voice channel first." };
  }

  const player = playerManager.peek(interaction.guildId);
  const botChannelId = player?.channelId || interaction.guild.members.me?.voice?.channelId;
  if (botChannelId && botChannelId !== channel.id) {
    return { error: "You need to be in the same voice channel as the bot." };
  }

  return { channel, player };
}

export function requireJoinableVoice(interaction, client) {
  const channel = getMemberVoiceChannel(interaction);
  if (!channel) {
    return { error: "Join a voice channel first." };
  }
  if (!client?.user) {
    return { error: "Bot is still starting up. Try again in a few seconds." };
  }
  if (!botCanSpeak(channel, client.user)) {
    return {
      error: "I need permission to **View Channel**, **Connect**, and **Speak** in that voice channel.",
    };
  }
  return { channel };
}

export async function fail(interaction, message) {
  return safeReply(interaction, ephemeral(message));
}
