import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const file = new URL('../data/settings.json', import.meta.url);
const defaults = { volume: 80, autoplay: false, stay247: false, djRoleId: '', musicChannelId: '', maxQueueSize: 100 };
let state = {};
function load(){ try { state = JSON.parse(readFileSync(file,'utf8')); } catch { state = {}; } }
function save(){ mkdirSync(dirname(file.pathname), {recursive:true}); writeFileSync(file, JSON.stringify(state,null,2)); }
load();
export function getGuildSettings(guildId){ return {...defaults, ...(state[guildId]||{})}; }
export function updateGuildSettings(guildId, patch){ state[guildId] = {...getGuildSettings(guildId), ...patch}; save(); return getGuildSettings(guildId); }
export { defaults as defaultGuildSettings };
