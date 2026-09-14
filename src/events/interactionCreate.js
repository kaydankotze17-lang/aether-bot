import { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from "discord.js";
import { commandMap } from "../commands/index.js";
import { logger } from "../logger.js";
import { playerManager } from "../player/PlayerManager.js";
import { requireSameVoice } from "../player/requirePlayer.js";
import { ephemeral, safeReply } from "../util/voice.js";
import { buildQueuePayload, buildLyricsPayload } from "../player/nowPlaying.js";
import { getGuildSettings } from "../configStore.js";
import { PermissionFlagsBits } from "discord.js";

const BUTTON_ACTIONS = {
  "aether:previous": (player) => player.previous(),
  "aether:pause": (player) => player.pause(),
  "aether:resume": (player) => player.resume(),
  "aether:skip": (player) => player.skip(),
  "aether:stop": (player) => player.stop(),
  "aether:shuffle": (player) => player.shuffle(),
};

export const name = Events.InteractionCreate;
export const once = false;

export async function execute(interaction, ctx) {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commandMap.get(interaction.commandName);
      if (!command) return safeReply(interaction, ephemeral("Unknown command. Re-register slash commands."));
      await command.execute(interaction, ctx);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("aether:")) await handleButton(interaction);
    if (interaction.isModalSubmit() && interaction.customId === "aether:volume-modal") await handleVolumeModal(interaction);
  } catch (error) {
    logger.error("Interaction error:", error);
    try { await safeReply(interaction, ephemeral(`Something went wrong: ${error?.message || "unknown error"}`)); } catch {}
  }
}

async function handleButton(interaction) {
  const customId = interaction.customId;
  const check = requireSameVoice(interaction);
  if (check.error && !customId.startsWith("aether:queue")) return safeReply(interaction, ephemeral(check.error));
  const player = check.player || playerManager.peek(interaction.guildId);
  if (!player && !customId.startsWith("aether:search:")) return safeReply(interaction, ephemeral("Nothing is playing."));

  if (customId === "aether:queue") return safeReply(interaction, { ...buildQueuePayload(player, 0), flags: 64 });
  if (customId.startsWith("aether:queue:")) {
    const [, , action, rawPage] = customId.split(":");
    const page = Number(rawPage) || 0;
    const total = Math.max(1, Math.ceil(player.tracks.length / 8));
    const target = action === "first" ? 0 : action === "last" ? total - 1 : action === "prev" ? page - 1 : page + 1;
    await interaction.update(buildQueuePayload(player, target));
    return;
  }
  if (customId === "aether:lyrics") return safeReply(interaction, { ...buildLyricsPayload(player), flags: 64 });
  if (customId === "aether:settings") {
    const modal = new ModalBuilder().setCustomId("aether:volume-modal").setTitle("Aether Settings");
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("volume").setLabel("Volume (0-100)").setStyle(TextInputStyle.Short).setRequired(true).setValue(String(player.volume)).setPlaceholder("80")));
    await interaction.showModal(modal);
    return;
  }
  const settings = getGuildSettings(interaction.guildId);
  if (settings.djRoleId && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !interaction.member?.roles?.cache?.has(settings.djRoleId)) {
    const restricted = ["aether:stop", "aether:previous", "aether:shuffle"];
    if (restricted.includes(customId)) return safeReply(interaction, ephemeral("Only the configured DJ role or a server manager can use that control."));
  }

  if (customId === "aether:loop") {
    const next = { off: "track", track: "queue", queue: "off" }[player.loop] || "off";
    player.setLoop(next); await interaction.deferUpdate(); await player.refreshControls(); return;
  }
  if (customId.startsWith("aether:search:")) {
    const index = Number(customId.split(":")[2]);
    const track = player.searchResults?.[index];
    if (!track) return safeReply(interaction, ephemeral("That search result expired. Run /search again."));
    await interaction.deferUpdate();
    await player.enqueue([track], { interaction, channel: interaction.member.voice.channel });
    await player.refreshControls();
    return;
  }

  const action = BUTTON_ACTIONS[customId];
  if (!action) return safeReply(interaction, ephemeral("Unknown button."));
  const message = action(player);
  await interaction.deferUpdate();
  await player.refreshControls();
  logger.info(`Button ${customId} in guild ${interaction.guildId}: ${message}`);
}

async function handleVolumeModal(interaction) {
  const check = requireSameVoice(interaction);
  if (check.error) return safeReply(interaction, ephemeral(check.error));
  if (!check.player) return safeReply(interaction, ephemeral("Nothing is playing."));
  const level = Number(interaction.fields.getTextInputValue("volume"));
  if (!Number.isInteger(level) || level < 0 || level > 100) return safeReply(interaction, ephemeral("Volume must be a whole number from 0 to 100."));
  check.player.setVolume(level);
  await interaction.reply({ content: `🔊 Aether volume set to **${level}%**.`, ephemeral: true });
  await check.player.refreshControls();
}
