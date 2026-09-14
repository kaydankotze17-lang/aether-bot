import { Events } from "discord.js";
import { playerManager } from "../player/PlayerManager.js";

function humanCount(channel) {
  if (!channel) return 0;
  return channel.members.filter((member) => !member.user.bot).size;
}

export const name = Events.VoiceStateUpdate;
export const once = false;

export async function execute(oldState, newState, { client }) {
  const guildId = newState.guild.id;
  const player = playerManager.peek(guildId);
  if (!player || !player.channelId) return;

  const channel = newState.guild.channels.cache.get(player.channelId);
  if (!channel) {
    player.leave();
    playerManager.delete(guildId);
    return;
  }

  const botId = client.user.id;
  const botStillHere = channel.members.has(botId);
  if (!botStillHere) {
    player.cleanup();
    playerManager.delete(guildId);
    return;
  }

  if (humanCount(channel) === 0) {
    if (player.stay247) player.clearEmptyTimer();
    else player.scheduleEmptyLeave();
  } else {
    player.clearEmptyTimer();
  }
}
