import { fetchJson } from "../util/http.js";
import { logger } from "../logger.js";

const FALLBACK_HOSTS = [
  "https://de2.api.radio-browser.info",
  "https://fi1.api.radio-browser.info",
  "https://de1.api.radio-browser.info",
  "https://at1.api.radio-browser.info",
];

let cachedHosts = [];
let cachedAt = 0;

async function discoverHosts() {
  if (cachedHosts.length && Date.now() - cachedAt < 30 * 60 * 1000) {
    return cachedHosts;
  }

  cachedHosts = [...FALLBACK_HOSTS];
  cachedAt = Date.now();
  return cachedHosts;
}

async function radioRequest(path) {
  const hosts = await discoverHosts();
  let lastError = null;

  for (const host of hosts) {
    try {
      return await fetchJson(`${host}${path}`, {
        headers: { Accept: "application/json" },
        timeout: 10000,
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Radio Browser is unavailable.");
}

export async function searchRadio(query, requestedBy, limit = 5) {
  const encoded = encodeURIComponent(query);
  const [byName, byTag] = await Promise.all([
    radioRequest(
      `/json/stations/search?name=${encoded}&limit=${limit}&hidebroken=true&order=votes&reverse=true`,
    ).catch(() => []),
    radioRequest(
      `/json/stations/search?tag=${encoded}&limit=${limit}&hidebroken=true&order=votes&reverse=true`,
    ).catch(() => []),
  ]);

  const merged = new Map();
  for (const station of [...(byName || []), ...(byTag || [])]) {
    if (!station?.stationuuid || !station.name || !(station.url_resolved || station.url)) continue;
    const existing = merged.get(station.stationuuid);
    if (!existing || (station.votes || 0) > (existing.votes || 0)) {
      merged.set(station.stationuuid, station);
    }
  }

  return [...merged.values()]
    .sort((a, b) => (b.votes || 0) - (a.votes || 0))
    .slice(0, limit)
    .map((station) => ({
      title: station.name,
      artist: [station.countrycode, station.tags].filter(Boolean).join(" · ") || "Live radio",
      durationSec: null,
      url: station.url_resolved || station.url,
      source: "radio",
      pageUrl: station.homepage || null,
      artworkUrl: station.favicon || null,
      requestedBy,
      stationUuid: station.stationuuid,
    }));
}

export async function getRadioStreamUrl(track) {
  if (track.stationUuid) {
    try {
      const clicked = await radioRequest(`/json/url/${encodeURIComponent(track.stationUuid)}`);
      if (clicked?.url) return clicked.url;
    } catch (error) {
      logger.warn("Radio Browser click URL failed, using cached stream.", error.message);
    }
  }
  if (track.url) return track.url;
  throw new Error("Radio station has no stream URL.");
}
