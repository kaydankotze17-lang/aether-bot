import play from "@iamtraction/play-dl";
import { logger } from "../logger.js";

function toTrack(track, requestedBy) {
  return {
    title: track.name || track.title || "Unknown title",
    artist: track.user?.name || track.channel?.name || "SoundCloud",
    durationSec: track.durationInSec ?? track.duration ?? null,
    url: track.url,
    source: "soundcloud",
    pageUrl: track.url,
    artworkUrl: track.thumbnail || track.thumbnails?.[0]?.url || null,
    requestedBy,
    soundcloudId: track.id,
  };
}

export function isSoundCloudUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    return (
      host === "soundcloud.com" ||
      host === "m.soundcloud.com" ||
      host === "on.soundcloud.com" ||
      host.endsWith(".soundcloud.com")
    );
  } catch {
    return false;
  }
}

export async function searchSoundCloud(query, requestedBy, limit = 5) {
  try {
    let results;
    try {
      results = await play.search(query, {
        limit,
        source: { soundcloud: "tracks" },
      });
    } catch {
      // older play-dl variants
      results = await play.search(query, { limit });
    }
    return (results || [])
      .filter((t) => t && t.url)
      .map((t) => toTrack(t, requestedBy));
  } catch (error) {
    logger.warn("SoundCloud search failed:", error.message);
    throw new Error(`SoundCloud search failed: ${error.message}`);
  }
}

export async function resolveSoundCloudUrl(url, requestedBy) {
  try {
    if (typeof play.soundcloud === "function") {
      const info = await play.soundcloud(url);
      if (info) {
        if (info.tracks && Array.isArray(info.tracks)) {
          return info.tracks.slice(0, 50).map((t) => toTrack(t, requestedBy));
        }
        return [toTrack(info, requestedBy)];
      }
    }
    // fallback via stream validation / search
    const results = await play.search(url, { limit: 1 });
    if (results?.length) return [toTrack(results[0], requestedBy)];
    throw new Error("Could not resolve SoundCloud URL");
  } catch (error) {
    logger.warn("SoundCloud resolve failed:", error.message);
    throw new Error(`Could not resolve SoundCloud URL: ${error.message}`);
  }
}

export async function createSoundCloudStream(track) {
  const streamInfo = await Promise.race([
    play.stream(track.url, {
    quality: 2,
    discordPlayerCompatibility: true,
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("SoundCloud stream timed out.")), 20000)),
  ]);
  return {
    stream: streamInfo.stream,
    type: streamInfo.type,
  };
}

export async function getSoundCloudStreamUrl(track) {
  if (!track.url) throw new Error("No SoundCloud URL on track");
  return track.url;
}
