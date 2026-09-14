import { fetchJson } from "../util/http.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const API = "https://api.audius.co/v1";

function artistName(track) {
  return track?.user?.name || track?.user?.handle || "Unknown artist";
}

function artworkUrl(track) {
  return (
    track?.artwork?.["480x480"] ||
    track?.artwork?.["150x150"] ||
    track?.artwork?.["1000x1000"] ||
    null
  );
}

function toTrack(track, requestedBy) {
  return {
    title: track.title || "Untitled",
    artist: artistName(track),
    durationSec: Number.isFinite(track.duration) ? track.duration : null,
    url: track.stream?.url || null,
    source: "audius",
    pageUrl: track.permalink ? `https://audius.co${track.permalink}` : null,
    artworkUrl: artworkUrl(track),
    requestedBy,
    audiusId: track.id,
  };
}

export function isAudiusUrl(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return host === "audius.co" || host === "audius.org" || host.endsWith(".audius.co");
  } catch {
    return false;
  }
}

export async function searchAudius(query, requestedBy, limit = 8) {
  const url = `${API}/tracks/search?query=${encodeURIComponent(query)}&limit=${limit}&app_name=${encodeURIComponent(config.appName)}`;
  const payload = await fetchJson(url);
  const results = Array.isArray(payload?.data) ? payload.data : [];
  return results
    .filter((track) => track && track.is_streamable && !track.is_stream_gated && track.id)
    .map((track) => toTrack(track, requestedBy));
}

export async function resolveAudiusUrl(pageUrl, requestedBy) {
  const url = `${API}/resolve?url=${encodeURIComponent(pageUrl)}&app_name=${encodeURIComponent(config.appName)}`;
  const payload = await fetchJson(url);
  const data = payload?.data;
  if (!data) return [];
  if (Array.isArray(data)) {
    return data
      .filter((track) => track?.is_streamable && track.id)
      .map((track) => toTrack(track, requestedBy));
  }
  if (data.is_streamable && data.id && data.title) {
    return [toTrack(data, requestedBy)];
  }
  return [];
}

export async function getAudiusStreamUrl(track) {
  if (track.url) return track.url;
  const id = track.audiusId;
  if (!id) throw new Error("Audius track is missing an id.");

  try {
    const details = await fetchJson(
      `${API}/tracks/${encodeURIComponent(id)}?app_name=${encodeURIComponent(config.appName)}`,
    );
    const stream = details?.data?.stream?.url;
    if (stream) return stream;
  } catch (error) {
    logger.warn("Audius track lookup failed, trying stream redirect.", error.message);
  }

  const streamUrl = `${API}/tracks/${encodeURIComponent(id)}/stream?app_name=${encodeURIComponent(config.appName)}`;
  return streamUrl;
}
