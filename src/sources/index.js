import { isHttpUrl } from "../util/http.js";
import { isAudiusUrl, searchAudius, resolveAudiusUrl, getAudiusStreamUrl } from "./audius.js";
import { searchRadio, getRadioStreamUrl } from "./radio.js";
import { isArchiveUrl, searchArchive, resolveArchiveUrl, getArchiveStreamUrl } from "./archive.js";
import { resolveDirectUrl, getDirectStreamUrl, looksLikeAudioUrl } from "./direct.js";
import {
  isYouTubeUrl,
  searchYouTube,
  resolveYouTubeUrl,
  getYouTubeStreamUrl,
  createYouTubeStream,
} from "./youtube.js";
import { isSpotifyUrl, resolveSpotifyUrl } from "./spotify.js";
import {
  isSoundCloudUrl,
  searchSoundCloud,
  resolveSoundCloudUrl,
  createSoundCloudStream,
  getSoundCloudStreamUrl,
} from "./soundcloud.js";
import {
  isMusicBrainzUrl,
  searchMusicBrainz,
  resolveMusicBrainzUrl,
} from "./musicbrainz.js";
import { logger } from "../logger.js";

function requestedByFrom(interaction) {
  return {
    id: interaction.user.id,
    tag: interaction.user.username,
  };
}

function stripPrefix(query, pattern) {
  return query.replace(pattern, "").trim();
}

export async function resolveQuery(query, interaction) {
  const requestedBy = requestedByFrom(interaction);
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Please provide a song, Spotify/YouTube/SoundCloud link, or audio URL.");
  }

  if (isHttpUrl(trimmed)) {
    if (isSpotifyUrl(trimmed)) {
      const tracks = await resolveSpotifyUrl(trimmed, requestedBy);
      if (tracks.length) return tracks;
    }
    if (isYouTubeUrl(trimmed)) {
      const tracks = await resolveYouTubeUrl(trimmed, requestedBy);
      if (tracks.length) return tracks;
    }
    if (isSoundCloudUrl(trimmed)) {
      const tracks = await resolveSoundCloudUrl(trimmed, requestedBy);
      if (tracks.length) return tracks;
    }
    if (isMusicBrainzUrl(trimmed)) {
      const tracks = await resolveMusicBrainzUrl(trimmed, requestedBy);
      if (tracks.length) return tracks;
    }
    if (isAudiusUrl(trimmed)) {
      const tracks = await resolveAudiusUrl(trimmed, requestedBy);
      if (tracks.length) return tracks;
    }
    if (isArchiveUrl(trimmed)) {
      const tracks = await resolveArchiveUrl(trimmed, requestedBy);
      if (tracks.length) return tracks;
    }
    return resolveDirectUrl(trimmed, requestedBy);
  }

  // Prefixes
  if (/^(sc|soundcloud)\s+/i.test(trimmed)) {
    const term = stripPrefix(trimmed, /^(sc|soundcloud)\s+/i);
    const items = await searchSoundCloud(term || trimmed, requestedBy);
    if (!items.length) throw new Error(`No SoundCloud results for "${term || trimmed}".`);
    return [items[0]];
  }

  if (/^(mb|musicbrainz)\s+/i.test(trimmed)) {
    const term = stripPrefix(trimmed, /^(mb|musicbrainz)\s+/i);
    const items = await searchMusicBrainz(term || trimmed, requestedBy);
    if (!items.length) throw new Error(`No MusicBrainz results for "${term || trimmed}".`);
    return [items[0]];
  }

  if (/^(spotify|sp)\s+/i.test(trimmed)) {
    const term = stripPrefix(trimmed, /^(spotify|sp)\s+/i);
    const items = await searchYouTube(term || trimmed, requestedBy);
    if (!items.length) throw new Error(`No results for "${term || trimmed}".`);
    items[0].source = "spotify";
    return [items[0]];
  }

  if (/^(yt|youtube)\s+/i.test(trimmed)) {
    const term = stripPrefix(trimmed, /^(yt|youtube)\s+/i);
    const items = await searchYouTube(term || trimmed, requestedBy);
    if (!items.length) throw new Error(`No YouTube results for "${term || trimmed}".`);
    return [items[0]];
  }

  if (/^(radio|station)\s+/i.test(trimmed)) {
    const term = stripPrefix(trimmed, /^(radio|station)\s+/i);
    const stations = await searchRadio(term || trimmed, requestedBy);
    if (!stations.length) throw new Error(`No radio stations found for "${term || trimmed}".`);
    return [stations[0]];
  }

  if (/^(archive|ia)\s+/i.test(trimmed)) {
    const term = stripPrefix(trimmed, /^(archive|ia)\s+/i);
    const items = await searchArchive(term || trimmed, requestedBy);
    if (!items.length) throw new Error(`No Internet Archive audio found for "${term || trimmed}".`);
    return [items[0]];
  }

  const errors = [];

  // Search multiple playable sources. We prefer SoundCloud/YouTube, but a source
  // failure must never block the others.
  const searchers = [
    ["YouTube", searchYouTube],
    ["SoundCloud", searchSoundCloud],
    ["Audius", searchAudius],
    ["MusicBrainz", searchMusicBrainz],
    ["Internet Archive", searchArchive],
  ];

  const results = await Promise.allSettled(
    searchers.map(async ([name, searcher]) => {
      const found = await Promise.race([
        searcher(trimmed, requestedBy, 5),
        new Promise((_, reject) => setTimeout(() => reject(new Error("search timed out")), 9000)),
      ]);
      return { name, tracks: found || [] };
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.tracks.length) {
      return [result.value.tracks[0]];
    }
    if (result.status === "rejected") {
      logger.warn("Source search failed:", result.reason?.message || result.reason);
    }
  }

  if (looksLikeAudioUrl(trimmed)) {
    return resolveDirectUrl(trimmed, requestedBy);
  }

  const detail = errors.length ? ` (${errors.join("; ")})` : "";
  throw new Error(
    `Nothing playable found for "${trimmed}". Try Spotify/YouTube/SoundCloud links, "sc query", "mb query", or a song name.${detail}`,
  );
}

export async function resolveStreamUrl(track) {
  switch (track.source) {
    case "spotify":
    case "youtube":
    case "musicbrainz":
      return getYouTubeStreamUrl(track);
    case "soundcloud":
      return getSoundCloudStreamUrl(track);
    case "audius":
      return getAudiusStreamUrl(track);
    case "radio":
      return getRadioStreamUrl(track);
    case "archive":
      return getArchiveStreamUrl(track);
    case "url":
      return getDirectStreamUrl(track);
    default:
      if (track.url) return track.url;
      throw new Error("This track has no stream source.");
  }
}


const FALLBACK_SEARCHERS = {
  youtube: [searchSoundCloud, searchAudius, searchArchive],
  soundcloud: [searchAudius, searchYouTube, searchArchive],
  audius: [searchSoundCloud, searchYouTube, searchArchive],
  musicbrainz: [searchSoundCloud, searchAudius, searchYouTube, searchArchive],
  archive: [searchAudius, searchSoundCloud, searchYouTube],
  radio: [searchYouTube, searchSoundCloud, searchAudius],
  spotify: [searchSoundCloud, searchAudius, searchYouTube, searchArchive],
  url: [searchSoundCloud, searchAudius, searchYouTube, searchArchive],
};

export async function resolveFallbackTrack(track, timeoutMs = 7000) {
  const query = `${track.artist || ""} ${track.title || ""}`.trim();
  if (!query) return null;

  const searchers = FALLBACK_SEARCHERS[track.source] || [
    searchSoundCloud,
    searchYouTube,
    searchAudius,
    searchArchive,
  ];

  for (const searcher of searchers) {
    try {
      const results = await Promise.race([
        searcher(query, track.requestedBy || { id: "0", tag: "Aether" }, 5),
        new Promise((_, reject) => setTimeout(() => reject(new Error("source search timeout")), timeoutMs)),
      ]);
      const candidates = Array.isArray(results) ? results : [];
      const next = candidates.find((item) =>
        item && item.url && item.url !== track.url && item.title,
      );
      if (next) return next;
    } catch (error) {
      logger.warn(`Fallback source failed for "${query}":`, error.message);
    }
  }
  return null;
}

export async function createStreamForTrack(track) {
  if (track.source === "youtube" || track.source === "spotify" || track.source === "musicbrainz") {
    return createYouTubeStream(track);
  }
  if (track.source === "soundcloud") {
    return createSoundCloudStream(track);
  }
  return null;
}

export function sourceLabel(source) {
  switch (source) {
    case "spotify":
      return "Spotify → YouTube";
    case "youtube":
      return "YouTube";
    case "soundcloud":
      return "SoundCloud";
    case "musicbrainz":
      return "MusicBrainz → Stream";
    case "audius":
      return "Audius";
    case "radio":
      return "Radio Browser";
    case "archive":
      return "Internet Archive";
    case "url":
      return "Direct URL";
    default:
      return source || "Unknown";
  }
}

export { searchYouTube, searchSoundCloud, searchMusicBrainz, searchAudius };
