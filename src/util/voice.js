import { ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";

export function ephemeral(content) {
  return { content, flags: MessageFlags.Ephemeral };
}

export function getMemberVoiceChannel(interaction) {
  const member = interaction.member;
  if (!member || typeof member !== "object" || !("voice" in member)) {
    return null;
  }
  const channel = member.voice?.channel;
  if (!channel) return null;
  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
    return null;
  }
  return channel;
}

export function botCanSpeak(channel, clientUser) {
  const permissions = channel.permissionsFor(clientUser);
  if (!permissions) return false;
  return (
    permissions.has(PermissionFlagsBits.ViewChannel) &&
    permissions.has(PermissionFlagsBits.Connect) &&
    permissions.has(PermissionFlagsBits.Speak)
  );
}

export async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.followUp(payload);
    }
    return await interaction.reply(payload);
  } catch (error) {
    return null;
  }
}

export async function safeEdit(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    }
    return await interaction.reply(payload);
  } catch {
    return safeReply(interaction, payload);
  }
}
