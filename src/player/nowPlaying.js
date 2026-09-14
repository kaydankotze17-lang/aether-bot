import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { formatDuration, formatLoop, truncate, buildProgressBar } from "../util/format.js";
import { sourceLabel } from "../sources/index.js";
import { getCurrentLyric } from "../util/lyrics.js";

const COLOR_AETHER = 0x8b5cf6;
const COLOR_PAUSED = 0xf59e0b;
const COLOR_IDLE = 0x111827;
const COLOR_QUEUE = 0x06b6d4;

function statusText(player, paused) {
  if (paused) return "PAUSED";
  if (player.isPlaying()) return "PLAYING";
  return "BUFFERING";
}

function loopIcon(mode) {
  if (mode === "track") return "🔂";
  if (mode === "queue") return "🔁";
  return "↪️";
}

function volumeBar(volume, width = 10) {
  const filled = Math.round((Math.max(0, Math.min(100, volume)) / 100) * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

export function buildNowPlayingPayload(player) {
  const current = player.current;

  if (!current) {
    const embed = new EmbedBuilder()
      .setColor(COLOR_IDLE)
      .setAuthor({ name: "AETHER • MUSIC SYSTEM" })
      .setTitle("🎧  Aether is ready")
      .setDescription("Start a track and this panel becomes your full Discord music player.")
      .addFields(
        { name: "🎵 Playback", value: "Waiting for a track", inline: true },
        { name: "📜 Queue", value: `${player.tracks.length} tracks`, inline: true },
        { name: "🔊 Volume", value: `${volumeBar(player.volume)}\n${player.volume}%`, inline: true },
      )
      .setFooter({ text: "Aether • /play • /queue • /search • /settings" });

    return {
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("aether:queue").setLabel("Queue").setEmoji("📜").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("aether:settings").setLabel("Settings").setEmoji("⚙️").setStyle(ButtonStyle.Secondary),
        ),
      ],
    };
  }

  const paused = player.isPaused();
  const position = player.getPositionSec?.() ?? 0;
  const duration = current.durationSec;
  const progress = buildProgressBar(position, duration, 20);
  const title = truncate(current.title, 160);
  const artist = truncate(current.artist, 80) || "Unknown artist";
  const queueCount = player.tracks.length;

  const embed = new EmbedBuilder()
    .setColor(paused ? COLOR_PAUSED : COLOR_AETHER)
    .setAuthor({
      name: `AETHER • ${statusText(player, paused)}`,
      iconURL: current.artworkUrl || undefined,
    })
    .setTitle(`🎵  ${title}`)
    .setDescription(`**${artist}**\n${sourceLabel(current.source)}${current.durationSec ? `  •  ${formatDuration(current.durationSec)}` : "  •  LIVE"}`)
    .addFields(
      { name: "⏱ Progress", value: `\`${progress}\``, inline: false },
      { name: "🔊 Volume", value: `${volumeBar(player.volume)}\n${player.volume}%`, inline: true },
      { name: "📜 Queue", value: `${queueCount} upcoming`, inline: true },
      { name: `${loopIcon(player.loop)} Loop`, value: formatLoop(player.loop), inline: true },
      { name: "🤖 Autoplay", value: player.autoplay ? "ON" : "OFF", inline: true },
      { name: "♾️ 24/7", value: player.stay247 ? "ON" : "OFF", inline: true },
    );

  if (player.lyrics?.synced?.length) {
    const lyric = getCurrentLyric(player.lyrics.synced, position);
    if (lyric?.current) {
      const nextLine = lyric.next ? `\n> *${truncate(lyric.next.text, 100)}*` : "";
      embed.addFields({ name: "🎤 Live Lyrics", value: `> **${truncate(lyric.current.text, 160)}**${nextLine}`, inline: false });
    }
  } else if (player.lyrics?.plain) {
    embed.addFields({ name: "🎤 Lyrics", value: truncate(player.lyrics.plain.split("\n").slice(0, 4).join("\n"), 300), inline: false });
  } else if (player.lyrics?.instrumental) {
    embed.addFields({ name: "🎤 Lyrics", value: "*Instrumental*", inline: false });
  }

  if (current.pageUrl) embed.setURL(current.pageUrl);
  if (current.artworkUrl) embed.setThumbnail(current.artworkUrl);
  embed.setFooter({ text: current.requestedBy?.tag ? `Requested by ${current.requestedBy.tag} • Aether` : "Aether • Music, controls & live progress" });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("aether:previous").setLabel("Prev").setEmoji("⏮️").setStyle(ButtonStyle.Secondary).setDisabled(player.history.length === 0),
    new ButtonBuilder().setCustomId(paused ? "aether:resume" : "aether:pause").setLabel(paused ? "Resume" : "Pause").setEmoji(paused ? "▶️" : "⏸️").setStyle(paused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("aether:skip").setLabel("Skip").setEmoji("⏭️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("aether:stop").setLabel("Stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("aether:shuffle").setLabel("Shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary).setDisabled(queueCount < 2),
    new ButtonBuilder().setCustomId("aether:loop").setLabel(formatLoop(player.loop)).setEmoji(loopIcon(player.loop)).setStyle(player.loop === "off" ? ButtonStyle.Secondary : ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("aether:queue").setLabel("Queue").setEmoji("📜").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("aether:lyrics").setLabel("Lyrics").setEmoji("🎤").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("aether:settings").setLabel("Settings").setEmoji("⚙️").setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2] };
}

export function buildQueuePayload(player, page = 0) {
  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(player.tracks.length / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * pageSize;
  const visible = player.tracks.slice(start, start + pageSize);

  const embed = new EmbedBuilder()
    .setColor(COLOR_QUEUE)
    .setAuthor({ name: "AETHER • QUEUE" })
    .setTitle(`📜  Up Next  •  Page ${safePage + 1}/${totalPages}`);

  if (!player.current && player.tracks.length === 0) {
    embed.setDescription("The queue is empty. Drop a track with **`/play <song>`**.");
    return { embeds: [embed], components: [] };
  }

  const lines = [];
  if (player.current) {
    lines.push(`▶️ **NOW PLAYING**`);
    lines.push(`**${truncate(player.current.title, 75)}** — ${truncate(player.current.artist, 35)}`);
    lines.push("");
  }

  if (!visible.length) lines.push("*No upcoming tracks.*");
  visible.forEach((track, index) => {
    const number = start + index + 1;
    lines.push(`**${String(number).padStart(2, "0")}**  ${truncate(track.title, 55)} — ${truncate(track.artist, 28)}`);
  });

  embed.setDescription(lines.join("\n"));
  embed.addFields(
    { name: "🎵 Tracks", value: `${player.tracks.length} queued`, inline: true },
    { name: "⏱ Total", value: formatDuration(player.tracks.reduce((sum, t) => sum + (Number.isFinite(t.durationSec) ? t.durationSec : 0), 0)), inline: true },
    { name: "🔁 Loop", value: formatLoop(player.loop), inline: true },
  );
  embed.setFooter({ text: "Aether • Use /play to add more" });

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`aether:queue:first:${safePage}`).setLabel("First").setEmoji("⏮️").setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
    new ButtonBuilder().setCustomId(`aether:queue:prev:${safePage}`).setLabel("Prev").setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
    new ButtonBuilder().setCustomId(`aether:queue:next:${safePage}`).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1),
    new ButtonBuilder().setCustomId(`aether:queue:last:${safePage}`).setLabel("Last").setEmoji("⏭️").setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1),
  );
  return { embeds: [embed], components: [nav] };
}

export function buildLyricsPayload(player) {
  const embed = new EmbedBuilder().setColor(COLOR_AETHER).setAuthor({ name: "AETHER • LYRICS" });
  if (!player.current) return { embeds: [embed.setTitle("🎤 No track playing").setDescription("Start a track with **/play**.")] };
  embed.setTitle(`🎤 ${truncate(player.current.title, 100)}`).setDescription(`**${truncate(player.current.artist, 80)}**`);
  if (player.lyrics?.plain) embed.addFields({ name: "Lyrics", value: truncate(player.lyrics.plain, 3800) });
  else if (player.lyrics?.instrumental) embed.addFields({ name: "Lyrics", value: "*Instrumental*" });
  else embed.addFields({ name: "Lyrics", value: "Lyrics aren't available for this track yet." });
  return { embeds: [embed] };
}
