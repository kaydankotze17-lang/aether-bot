import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const file = new URL('./data/favorites.json', import.meta.url);
let state = {};

try { state = JSON.parse(readFileSync(file, 'utf8')); } catch { state = {}; }

function save() {
  mkdirSync(dirname(file.pathname), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2));
}

export function listFavorites(userId) { return Array.isArray(state[userId]) ? state[userId] : []; }

export function addFavorite(userId, track) {
  const list = listFavorites(userId);
  const exists = list.some((t) => t.url === track.url && t.source === track.source);
  if (exists) return false;
  list.push({
    title: track.title,
    artist: track.artist || 'Unknown artist',
    url: track.url,
    pageUrl: track.pageUrl || track.url,
    artworkUrl: track.artworkUrl || '',
    durationSec: track.durationSec ?? null,
    source: track.source,
  });
  state[userId] = list.slice(-50);
  save();
  return true;
}

export function removeFavorite(userId, index) {
  const list = listFavorites(userId);
  if (index < 1 || index > list.length) return null;
  const [removed] = list.splice(index - 1, 1);
  state[userId] = list;
  save();
  return removed;
}

export function clearFavorites(userId) {
  delete state[userId];
  save();
}
