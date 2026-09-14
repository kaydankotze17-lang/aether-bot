import { fetchWithTimeout } from "../util/http.js";
import { logger } from "../logger.js";
import { searchYouTube } from "./youtube.js";

/**
 * Detect Spotify links (track, album, playlist, artist)
 */
export function isSpotifyUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    return (
      host === "open.spotify.com" ||
      host === "spotify.com" ||
      host === "play.spotify.com" ||
      host.endsWith(".spotify.com")
    );
  } catch {
    return false;
  }
}

function parseSpotifyUrl(url) {
  try {
    const u = new URL(url);
    // /track/xxx  /album/xxx  /playlist/xxx  /artist/xxx  /intl-xx/track/xxx
    const parts = u.pathname.split("/").filter(Boolean);
    // skip locale prefixes like intl-en
    const typeIdx = parts.findIndex((p) =>
      ["track", "album", "playlist", "artist", "episode", "show"].includes(p),
    );
    if (typeIdx === -1) return null;
    const type = parts[typeIdx];
    const id = parts[typeIdx + 1]?.split("?")[0];
    if (!id) return null;
    return { type, id };
  } catch {
    return null;
  }
}

/**
 * Get basic metadata via Spotify oEmbed (no auth needed)
 */
async function getOEmbed(spotifyUrl) {
  const oembed = `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`;
  const res = await fetchWithTimeout(oembed, {
    headers: { Accept: "application/json" },
    timeout: 8000,
  });
  if (!res.ok) throw new Error(`oEmbed ${res.status}`);
  return res.json();
}

/**
 * Resolve a Spotify track → search YouTube for the best match
 */
async function resolveTrack(spotifyUrl, requestedBy) {
  const meta = await getOEmbed(spotifyUrl);
  // oEmbed title is usually "Song Name · Artist"
  const title = meta.title || "Unknown track";
  let artist = "Unknown";
  let song = title;

  // Spotify oEmbed often: "Track Name - Artist Name" or "Track · Artist"
  if (title.includes(" · ")) {
    const [t, a] = title.split(" · ");
    song = t.trim();
    artist = a.trim();
  } else if (title.includes(" - ")) {
    const parts = title.split(" - ");
    if (parts.length >= 2) {
      song = parts[0].trim();
      artist = parts.slice(1).join(" - ").trim();
    }
  }

  const query = `${artist} ${song}`.trim();
  logger.info(`Spotify → YouTube search: "${query}"`);

  const ytResults = await searchYouTube(query, requestedBy, 3);
  if (!ytResults.length) {
    throw new Error(`No YouTube match found for Spotify track: ${title}`);
  }

  // Prefer the first solid result, mark origin
  const track = ytResults[0];
  track.source = "spotify";          // show as Spotify in UI
  track.originalSource = "youtube";  // actual stream is YT
  track.spotifyUrl = spotifyUrl;
  track.pageUrl = spotifyUrl;        // link back to Spotify
  track.title = song || track.title;
  track.artist = artist || track.artist;
  if (meta.thumbnail_url) {
    track.artworkUrl = meta.thumbnail_url;
  }
  return [track];
}

/**
 * For album / playlist we resolve the first track only for now
 * (full playlist would need Spotify API credentials)
 * Users can still paste individual tracks.
 */
async function resolveCollection(spotifyUrl, type, requestedBy) {
  // oEmbed for album/playlist gives the collection name
  const meta = await getOEmbed(spotifyUrl);
  const name = meta.title || type;
  // Fall back to searching the collection name on YouTube
  // (not perfect but better than nothing)
  const query = name.replace(/Playlist|Album|by .*/gi, "").trim();
  const yt = await searchYouTube(query, requestedBy, 1);
  if (!yt.length) {
    throw new Error(`Could not resolve Spotify ${type}: ${name}`);
  }
  const track = yt[0];
  track.source = "spotify";
  track.spotifyUrl = spotifyUrl;
  track.pageUrl = spotifyUrl;
  track.title = `${track.title} (from Spotify ${type})`;
  return [track];
}

export async function resolveSpotifyUrl(url, requestedBy) {
  const parsed = parseSpotifyUrl(url);
  if (!parsed) {
    throw new Error("Invalid Spotify URL");
  }

  try {
    if (parsed.type === "track") {
      return await resolveTrack(url, requestedBy);
    }
    // album / playlist / artist → best-effort single track for now
    return await resolveCollection(url, parsed.type, requestedBy);
  } catch (err) {
    logger.warn("Spotify resolve failed:", err.message);
    throw new Error(`Spotify link failed: ${err.message}. Try the track name instead.`);
  }
}

export async function searchSpotify(query, requestedBy) {
  // No official search without credentials → just treat as YouTube search
  // but tag it so the UI shows Spotify flavor if desired
  const results = await searchYouTube(query, requestedBy, 5);
  return results.map((t) => {
    t.source = "spotify";
    return t;
  });
}
