import * as play from "./play.js";
import * as pause from "./pause.js";
import * as resume from "./resume.js";
import * as skip from "./skip.js";
import * as stop from "./stop.js";
import * as queue from "./queue.js";
import * as volume from "./volume.js";
import * as loop from "./loop.js";
import * as shuffle from "./shuffle.js";
import * as join from "./join.js";
import * as leave from "./leave.js";
import * as search from "./search.js";
import * as settings from "./settings.js";
import * as nowplaying from "./nowplaying.js";
import * as history from "./history.js";
import * as remove from "./remove.js";
import * as move from "./move.js";
import * as clear from "./clear.js";
import * as playnext from "./playnext.js";
import * as timer from "./timer.js";
import * as favorites from "./favorites.js";
import * as lyrics from "./lyrics.js";


export const commands = [play, pause, resume, skip, stop, queue, volume, loop, shuffle, join, leave, search, settings, nowplaying, history, remove, move, clear, playnext, timer, favorites, lyrics];

export const commandMap = new Map(commands.map((command) => [command.data.name, command]));

export function commandJson() {
  return commands.map((command) => command.data.toJSON());
}
