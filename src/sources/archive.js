import { fetchJson } from "../util/http.js";

const AUDIO_FORMATS = [
  "VBR MP3",
  "MP3",
  "Ogg Vorbis",
  "OGG VORBIS",
  "Flac",
  "FLAC",
  "WAVE",
  "WAV",
  "AIFF",
  "MPEG4",
  "64Kbps MP3",
  "128Kbps MP3",
];

function pickAudioFile(files) {
  const audio = (files || []).filter((file) => {
    const format = String(file.format || "");
    const name = String(file.name || "").toLowerCase();
    return (
      AUDIO_FORMATS.includes(format) ||
      name.endsWith(".mp3") ||
      name.endsWith(".ogg") ||
      name.endsWith(".oga") ||
      name.endsWith(".flac") ||
      name.endsWith(".wav") ||
      name.endsWith(".m4a")
    );
  });

  audio.sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
  return audio[0] || null;
}

function archiveDownloadUrl(identifier, filename) {
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(filename)}`;
}

export function isArchiveUrl(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return host === "archive.org" || host.endsWith(".archive.org");
  } catch {
    return false;
  }
}

async function metadataToTrack(identifier, requestedBy, fallbackTitle) {
  const meta = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  const file = pickAudioFile(meta?.files);
  if (!file) return null;

  const title = meta?.metadata?.title || fallbackTitle || identifier;
  const artist = Array.isArray(meta?.metadata?.creator)
    ? meta.metadata.creator.join(", ")
    : meta?.metadata?.creator || "Internet Archive";

  const length = meta?.metadata?.runtime || file.length || null;
  let durationSec = null;
  if (typeof length === "number") durationSec = length;
  else if (typeof length === "string" && length.includes(":")) {
    const parts = length.split(":").map((part) => Number(part));
    if (parts.every((n) => Number.isFinite(n))) {
      durationSec = parts.reduce((sum, part) => sum * 60 + part, 0);
    }
  }

  return {
    title,
    artist,
    durationSec,
    url: archiveDownloadUrl(identifier, file.name),
    source: "archive",
    pageUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    artworkUrl: null,
    requestedBy,
    archiveId: identifier,
    archiveFile: file.name,
  };
}

export async function searchArchive(query, requestedBy, limit = 5) {
  const q = `${query} AND mediatype:(audio)`;
  const url =
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}` +
    `&fl[]=identifier&fl[]=title&fl[]=creator&rows=${limit}&page=1&output=json`;
  const payload = await fetchJson(url);
  const docs = payload?.response?.docs || [];
  const tracks = [];

  for (const doc of docs) {
    if (!doc.identifier) continue;
    try {
      const track = await metadataToTrack(doc.identifier, requestedBy, doc.title);
      if (track) tracks.push(track);
    } catch {
      // Skip items that have no playable audio file.
    }
  }

  return tracks;
}

export async function resolveArchiveUrl(pageUrl, requestedBy) {
  const parsed = new URL(pageUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const detailsIndex = parts.indexOf("details");
  const downloadIndex = parts.indexOf("download");
  const identifier = parts[detailsIndex + 1] || parts[downloadIndex + 1];
  if (!identifier) return [];
  const track = await metadataToTrack(identifier, requestedBy);
  return track ? [track] : [];
}

export async function getArchiveStreamUrl(track) {
  if (track.url) return track.url;
  if (!track.archiveId) throw new Error("Archive item is missing an identifier.");
  const resolved = await metadataToTrack(track.archiveId, track.requestedBy, track.title);
  if (!resolved?.url) throw new Error("Archive item has no playable audio file.");
  return resolved.url;
}
