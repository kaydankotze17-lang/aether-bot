import { fetchJson } from "../util/http.js";
import { logger } from "../logger.js";
import { searchYouTube } from "./youtube.js";
import { searchSoundCloud } from "./soundcloud.js";

const MB_API = "https://musicbrainz.org/ws/2";
const COVER_ART = "https://coverartarchive.org";

/**
 * MusicBrainz is metadata only. We search recordings then resolve audio
 * via YouTube / SoundCloud so the user still gets something playable.
 */
export function isMusicBrainzUrl(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return host === "musicbrainz.org" || host.endsWith(".musicbrainz.org");
  } catch {
    return false;
  }
}

async function mbFetch(path, params = {}) {
  const qs = new URLSearchParams({ fmt: "json", ...params });
  const url = `${MB_API}${path}?${qs.toString()}`;
  return fetchJson(url, {
    headers: {
      "User-Agent": "AetherDiscordBot/1.0 (music; contact: aether-bot)",
      Accept: "application/json",
    },
    timeout: 10000,
  });
}

function pickArtist(recording) {
  const credit = recording["artist-credit"];
  if (!Array.isArray(credit) || !credit.length) return "Unknown artist";
  return credit
    .map((c) => c.name || c.artist?.name || "")
    .filter(Boolean)
    .join(" ");
}

function pickTitle(recording) {
  return recording.title || "Unknown title";
}

async function getCoverArt(releaseId) {
  if (!releaseId) return null;
  try {
    const data = await fetchJson(`${COVER_ART}/release/${releaseId}`, {
      timeout: 5000,
      headers: { Accept: "application/json" },
    });
    const image = data.images?.find((i) => i.front) || data.images?.[0];
    return image?.thumbnails?.large || image?.thumbnails?.small || image?.image || null;
  } catch {
    return null;
  }
}

/**
 * Search MusicBrainz recordings and turn the best hits into playable tracks
 * by searching YouTube (primary) / SoundCloud.
 */
export async function searchMusicBrainz(query, requestedBy, limit = 5) {
  try {
    const data = await mbFetch("/recording", {
      query: query,
      limit: String(Math.min(limit, 10)),
    });

    const recordings = data.recordings || [];
    if (!recordings.length) return [];

    const tracks = [];
    for (const rec of recordings.slice(0, limit)) {
      const title = pickTitle(rec);
      const artist = pickArtist(rec);
      const durationSec = rec.length ? Math.round(rec.length / 1000) : null;
      const searchQ = `${artist} ${title}`.trim();

      // Prefer YouTube, fall back to SoundCloud
      let playable = null;
      try {
        const yt = await searchYouTube(searchQ, requestedBy, 1);
        if (yt.length) playable = yt[0];
      } catch {
        /* ignore */
      }
      if (!playable) {
        try {
          const sc = await searchSoundCloud(searchQ, requestedBy, 1);
          if (sc.length) playable = sc[0];
        } catch {
          /* ignore */
        }
      }
      if (!playable) continue;

      // Enrich with MB metadata
      playable.source = "musicbrainz";
      playable.title = title;
      playable.artist = artist;
      playable.durationSec = durationSec || playable.durationSec;
      playable.mbid = rec.id;
      playable.pageUrl = `https://musicbrainz.org/recording/${rec.id}`;

      // Try cover art from first release
      const releaseId = rec.releases?.[0]?.id;
      if (releaseId) {
        const art = await getCoverArt(releaseId);
        if (art) playable.artworkUrl = art;
      }

      tracks.push(playable);
    }
    return tracks;
  } catch (error) {
    logger.warn("MusicBrainz search failed:", error.message);
    throw new Error(`MusicBrainz search failed: ${error.message}`);
  }
}

export async function resolveMusicBrainzUrl(url, requestedBy) {
  // Extract MBID if present
  const m = url.match(/musicbrainz\.org\/(recording|release|release-group|artist)\/([a-f0-9-]{36})/i);
  if (!m) {
    // treat as search
    return searchMusicBrainz(url, requestedBy, 1);
  }
  const [, type, id] = m;

  if (type === "recording") {
    const rec = await mbFetch(`/recording/${id}`, { inc: "artists+releases" });
    const title = pickTitle(rec);
    const artist = pickArtist(rec);
    const q = `${artist} ${title}`;
    const yt = await searchYouTube(q, requestedBy, 1);
    if (!yt.length) throw new Error("No playable match for this MusicBrainz recording");
    const track = yt[0];
    track.source = "musicbrainz";
    track.title = title;
    track.artist = artist;
    track.mbid = id;
    track.pageUrl = url;
    return [track];
  }

  // For release / artist just search the name
  const entity = await mbFetch(`/${type}/${id}`);
  const name = entity.title || entity.name || id;
  return searchMusicBrainz(name, requestedBy, 3);
}
