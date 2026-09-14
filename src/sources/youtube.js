import { Readable } from "node:stream";
import { Innertube, UniversalCache } from "youtubei.js";
import { logger } from "../logger.js";

const SEARCH_TIMEOUT_MS = 15_000;
const STREAM_TIMEOUT_MS = 30_000;

let clientPromise = null;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function getClient() {
  if (!clientPromise) {
    clientPromise = Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
    }).catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

function videoIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname.replace(/^www\./, "") === "youtu.be") {
      return url.pathname.slice(1).split("/")[0] || null;
    }
    return url.searchParams.get("v") || url.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/i)?.[1] || null;
  } catch {
    return null;
  }
}

function thumbnailFrom(video) {
  return (
    video?.thumbnails?.[0]?.url ||
    video?.thumbnail?.[0]?.url ||
    video?.thumbnail?.url ||
    null
  );
}

function toTrack(video, requestedBy) {
  const id = video?.id || video?.video_id;
  const title = video?.title?.toString?.() || video?.title || "Unknown title";
  const artist =
    video?.author?.name?.toString?.() ||
    video?.author?.toString?.() ||
    video?.owner?.name?.toString?.() ||
    "YouTube";

  return {
    title,
    artist,
    durationSec: Number(video?.duration?.seconds ?? video?.durationInSec ?? 0) || null,
    url: id ? `https://www.youtube.com/watch?v=${id}` : null,
    source: "youtube",
    pageUrl: id ? `https://www.youtube.com/watch?v=${id}` : null,
    artworkUrl: thumbnailFrom(video),
    requestedBy,
    youtubeId: id,
  };
}

export function isYouTubeUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    return (
      host === "youtube.com" ||
      host === "youtu.be" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host.endsWith(".youtube.com")
    );
  } catch {
    return false;
  }
}

export async function searchYouTube(query, requestedBy, limit = 5) {
  try {
    const youtube = await withTimeout(getClient(), SEARCH_TIMEOUT_MS, "YouTube client initialization timed out.");
    const search = await withTimeout(
      youtube.search(query, { type: "video" }),
      SEARCH_TIMEOUT_MS,
      "YouTube search timed out.",
    );

    return (search?.videos || [])
      .filter((video) => video?.id && video?.title)
      .slice(0, limit)
      .map((video) => toTrack(video, requestedBy))
      .filter((track) => track.url);
  } catch (error) {
    logger.warn("YouTube search failed:", error.message);
    throw new Error(`YouTube search failed: ${error.message}`);
  }
}

export async function resolveYouTubeUrl(url, requestedBy) {
  const id = videoIdFromUrl(url);
  if (!id) {
    throw new Error("Could not extract a YouTube video ID from that URL.");
  }

  try {
    const youtube = await withTimeout(getClient(), SEARCH_TIMEOUT_MS, "YouTube client initialization timed out.");
    const info = await withTimeout(
      youtube.getBasicInfo(id),
      SEARCH_TIMEOUT_MS,
      "YouTube video lookup timed out.",
    );

    return [toTrack(info.basic_info, requestedBy)];
  } catch (error) {
    logger.warn("YouTube resolve failed:", error.message);
    throw new Error(`Could not resolve YouTube URL: ${error.message}`);
  }
}

export async function getYouTubeStreamUrl(track) {
  if (!track.youtubeId && !track.url) {
    throw new Error("YouTube track is missing its video URL.");
  }

  const id = track.youtubeId || videoIdFromUrl(track.url);
  if (!id) throw new Error("Could not extract the YouTube video ID.");

  const youtube = await withTimeout(
    getClient(),
    SEARCH_TIMEOUT_MS,
    "YouTube client initialization timed out.",
  );

  const format = await withTimeout(
    youtube.getStreamingData(id, {
      type: "audio",
      quality: "best",
      format: "mp4",
    }),
    STREAM_TIMEOUT_MS,
    "YouTube stream lookup timed out.",
  );

  if (!format?.url) throw new Error("YouTube did not return an audio stream URL.");
  return format.url;
}

export async function createYouTubeStream(track) {
  if (!track.youtubeId && !track.url) {
    throw new Error("YouTube track is missing its video URL.");
  }

  const id = track.youtubeId || videoIdFromUrl(track.url);
  if (!id) throw new Error("Could not extract the YouTube video ID.");

  const youtube = await withTimeout(
    getClient(),
    SEARCH_TIMEOUT_MS,
    "YouTube client initialization timed out.",
  );

  const download = await withTimeout(
    youtube.download(id, {
      type: "audio",
      quality: "best",
      format: "mp4",
    }),
    STREAM_TIMEOUT_MS,
    "YouTube audio stream timed out.",
  );

  const stream = download?.stream || download;
  if (!stream) throw new Error("YouTube returned no audio stream.");

  const readable = typeof stream.pipe === "function"
    ? stream
    : typeof stream.getReader === "function"
      ? Readable.fromWeb(stream)
      : Readable.from(stream);

  return {
    stream: readable,
    type: "arbitrary",
  };
}
