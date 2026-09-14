import { fetchJson } from "./http.js";
import { logger } from "../logger.js";

const LRCLIB = "https://lrclib.net/api";

/**
 * Parse LRC synced lyrics into [{ time: seconds, text }]
 */
export function parseSyncedLyrics(lrc) {
  if (!lrc || typeof lrc !== "string") return [];
  const lines = [];
  const regex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/g;
  let match;
  while ((match = regex.exec(lrc)) !== null) {
    const min = parseInt(match[1], 10);
    const sec = parseInt(match[2], 10);
    const ms = match[3] ? parseInt(match[3].padEnd(3, "0").slice(0, 3), 10) : 0;
    const time = min * 60 + sec + ms / 1000;
    const text = (match[4] || "").trim();
    if (text) lines.push({ time, text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

export async function fetchLyrics(track) {
  if (!track?.title) return null;
  const artist = track.artist || "";
  const title = track.title.replace(/\(.*?\)|\[.*?\]/g, "").trim(); // clean feat etc a bit
  const duration = track.durationSec ? Math.round(track.durationSec) : undefined;

  try {
    const params = new URLSearchParams({ track_name: title });
    if (artist && artist !== "YouTube" && artist !== "Unknown") {
      params.set("artist_name", artist);
    }
    if (duration) params.set("duration", String(duration));

    const data = await fetchJson(`${LRCLIB}/get?${params.toString()}`, {
      headers: { "User-Agent": "AetherDiscordBot/1.0 (lyrics)" },
      timeout: 8000,
    });

    if (!data) return null;

    const synced = data.syncedLyrics ? parseSyncedLyrics(data.syncedLyrics) : [];
    const plain = data.plainLyrics || null;

    return {
      synced,
      plain,
      instrumental: !!data.instrumental,
      source: "lrclib",
    };
  } catch (err) {
    // try search fallback
    try {
      const q = `${artist} ${title}`.trim();
      const results = await fetchJson(
        `${LRCLIB}/search?q=${encodeURIComponent(q)}&limit=3`,
        { headers: { "User-Agent": "AetherDiscordBot/1.0 (lyrics)" }, timeout: 6000 },
      );
      if (Array.isArray(results) && results.length) {
        const best = results[0];
        const synced = best.syncedLyrics ? parseSyncedLyrics(best.syncedLyrics) : [];
        return {
          synced,
          plain: best.plainLyrics || null,
          instrumental: !!best.instrumental,
          source: "lrclib-search",
        };
      }
    } catch (e2) {
      logger.warn("Lyrics search also failed:", e2.message);
    }
    logger.warn("Lyrics fetch failed:", err.message);
    return null;
  }
}

/**
 * Get the current lyric line + next for a given playback position (seconds)
 */
export function getCurrentLyric(synced, positionSec) {
  if (!synced || !synced.length) return null;
  let current = null;
  let next = null;
  for (let i = 0; i < synced.length; i++) {
    if (synced[i].time <= positionSec) {
      current = synced[i];
      next = synced[i + 1] || null;
    } else {
      break;
    }
  }
  return { current, next };
}
