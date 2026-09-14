export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
    return "Live";
  }
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function truncate(text, max = 80) {
  const value = String(text || "").trim() || "Unknown";
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}...`;
}

export function formatLoop(mode) {
  if (mode === "track") return "Track";
  if (mode === "queue") return "Queue";
  return "Off";
}

export function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Spotify-style progress bar
 * e.g. 1:23 ████████░░░░░░░░ 3:45
 */
export function buildProgressBar(currentSec, totalSec, width = 16) {
  if (!Number.isFinite(totalSec) || totalSec <= 0) {
    return `${formatDuration(currentSec)}  ● LIVE`;
  }
  const pos = Math.max(0, Math.min(currentSec, totalSec));
  const ratio = pos / totalSec;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `${formatDuration(pos)}  ${bar}  ${formatDuration(totalSec)}`;
}
