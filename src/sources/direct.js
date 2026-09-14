import { fetchWithTimeout, isHttpUrl } from "../util/http.js";

const AUDIO_EXTENSIONS = [".mp3", ".ogg", ".oga", ".wav", ".flac", ".m4a", ".aac", ".opus", ".webm"];

function filenameFromUrl(url) {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    return name.replace(/\.[a-z0-9]+$/i, "") || "Direct audio";
  } catch {
    return "Direct audio";
  }
}

async function parsePlaylist(url) {
  const response = await fetchWithTimeout(url, { timeout: 10000 });
  if (!response.ok) {
    throw new Error(`Could not read playlist (${response.status}).`);
  }
  const text = await response.text();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const streams = [];

  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (line.toLowerCase().startsWith("file")) {
      const value = line.split("=").slice(1).join("=").trim();
      if (isHttpUrl(value)) streams.push(value);
      continue;
    }
    if (isHttpUrl(line)) streams.push(line);
  }

  return streams;
}

export function looksLikeAudioUrl(value) {
  if (!isHttpUrl(value)) return false;
  const parsed = new URL(value);
  const path = parsed.pathname.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => path.endsWith(ext)) || path.endsWith(".m3u") || path.endsWith(".m3u8") || path.endsWith(".pls");
}

export async function resolveDirectUrl(url, requestedBy) {
  const parsed = new URL(url);
  const path = parsed.pathname.toLowerCase();

  if (path.endsWith(".m3u") || path.endsWith(".pls")) {
    const streams = await parsePlaylist(url);
    if (!streams.length) {
      throw new Error("That playlist did not contain a playable stream URL.");
    }
    return streams.slice(0, 10).map((stream, index) => ({
      title: `${filenameFromUrl(url)}${streams.length > 1 ? ` (${index + 1})` : ""}`,
      artist: parsed.hostname,
      durationSec: null,
      url: stream,
      source: "url",
      pageUrl: url,
      artworkUrl: null,
      requestedBy,
    }));
  }

  return [
    {
      title: filenameFromUrl(url),
      artist: parsed.hostname,
      durationSec: path.endsWith(".m3u8") ? null : null,
      url,
      source: "url",
      pageUrl: url,
      artworkUrl: null,
      requestedBy,
    },
  ];
}

export async function getDirectStreamUrl(track) {
  if (!track.url) throw new Error("Direct track is missing a URL.");
  return track.url;
}
