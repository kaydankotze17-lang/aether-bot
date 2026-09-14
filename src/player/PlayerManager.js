import { GuildPlayer } from "./GuildPlayer.js";

export class PlayerManager {
  constructor() {
    this.players = new Map();
  }

  get(guild) {
    let player = this.players.get(guild.id);
    if (!player || player.destroyed) {
      player = new GuildPlayer(guild);
      this.players.set(guild.id, player);
    }
    return player;
  }

  peek(guildId) {
    return this.players.get(guildId) || null;
  }

  delete(guildId) {
    const player = this.players.get(guildId);
    if (player) {
      player.cleanup();
      this.players.delete(guildId);
    }
  }
}

export const playerManager = new PlayerManager();
