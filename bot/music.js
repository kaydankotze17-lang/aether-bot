import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState
} from "@discordjs/voice";

import play from "play-dl";

export class AetherMusicManager {
  constructor(client) {
    this.client = client;
    this.players = new Map();
  }

  getGuildPlayer(guildId) {
    if (!this.players.has(guildId)) {
      const player = createAudioPlayer();

      const state = {
        guildId,
        player,
        connection: null,
        queue: [],
        current: null,
        volume: 80,
        repeat: "off",
        textChannelId: null
      };

      player.on(
        AudioPlayerStatus.Idle,
        () => {
          this.handleTrackEnd(guildId);
        }
      );

      player.on(
        "error",
        error => {
          console.error(
            `[AETHER MUSIC] Player error in ${guildId}:`,
            error
          );

          state.current = null;
          this.handleTrackEnd(guildId);
        }
      );

      this.players.set(guildId, state);
    }

    return this.players.get(guildId);
  }

  async connect(guild, voiceChannelId) {
    if (!guild) {
      throw new Error("Guild not found.");
    }

    if (!voiceChannelId) {
      throw new Error("No voice channel was provided.");
    }

    const channel =
      guild.channels.cache.get(voiceChannelId);

    if (!channel) {
      throw new Error("Voice channel not found.");
    }

    if (
      channel.type !== 2 &&
      channel.type !== 13
    ) {
      throw new Error(
        "The selected channel is not a voice channel."
      );
    }

    const connection =
      joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true
      });

    const state =
      this.getGuildPlayer(guild.id);

    state.connection = connection;

    connection.subscribe(state.player);

    connection.on(
      VoiceConnectionStatus.Disconnected,
      async () => {
        try {
          await Promise.race([
            entersState(
              connection,
              VoiceConnectionStatus.Signalling,
              5000
            ),
            entersState(
              connection,
              VoiceConnectionStatus.Connecting,
              5000
            )
          ]);
        } catch {
          connection.destroy();

          if (state.connection === connection) {
            state.connection = null;
          }
        }
      }
    );

    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      15000
    );

    console.log(
      `[AETHER MUSIC] Connected to ${guild.name} / ${channel.name}`
    );

    return connection;
  }

  async search(query) {
    const results =
      await play.search(query, {
        limit: 5,
        source: {
          youtube: "video"
        }
      });

    if (!results.length) {
      throw new Error(
        `No YouTube results found for "${query}".`
      );
    }

    return results[0];
  }

  async createTrack(query, requester = null) {
    let result;

    if (
      query.startsWith("http://") ||
      query.startsWith("https://")
    ) {
      result = {
        url: query,
        title: query,
        durationRaw: null,
        thumbnail: null
      };
    } else {
      result = await this.search(query);
    }

    return {
      url: result.url,
      title: result.title || query,
      duration:
        result.durationRaw || result.durationInSec || null,
      thumbnail:
        result.thumbnails?.[0]?.url ||
        result.thumbnail ||
        null,
      requester
    };
  }

  async playTrack(state, track) {
    if (!state.connection) {
      throw new Error(
        "The bot is not connected to a voice channel."
      );
    }

    console.log(
      `[AETHER MUSIC] Loading: ${track.title}`
    );

    const stream =
      await play.stream(track.url, {
        quality: 2,
        discordPlayerCompatibility: true
      });

    const resource =
      createAudioResource(
        stream.stream,
        {
          inputType: stream.type || StreamType.WebmOpus,
          inlineVolume: true
        }
      );

    resource.volume.setVolume(
      Math.max(0, Math.min(100, state.volume)) / 100
    );

    state.current = track;

    state.player.play(resource);

    console.log(
      `[AETHER MUSIC] Playing: ${track.title}`
    );
  }

  async playNext(guildId) {
    const state =
      this.getGuildPlayer(guildId);

    if (
      state.repeat === "track" &&
      state.current
    ) {
      return this.playTrack(
        state,
        state.current
      );
    }

    const next =
      state.queue.shift();

    if (!next) {
      state.current = null;
      return;
    }

    return this.playTrack(
      state,
      next
    );
  }

  async handleTrackEnd(guildId) {
    const state =
      this.players.get(guildId);

    if (!state) {
      return;
    }

    if (state.repeat === "track" && state.current) {
      try {
        await this.playTrack(
          state,
          state.current
        );
      } catch (error) {
        console.error(
          "[AETHER MUSIC] Repeat failed:",
          error
        );

        state.current = null;
        await this.playNext(guildId);
      }

      return;
    }

    state.current = null;

    try {
      await this.playNext(guildId);
    } catch (error) {
      console.error(
        `[AETHER MUSIC] Next track failed in ${guildId}:`,
        error
      );
    }
  }

  async handleCommand({
    guildId,
    command,
    payload = {}
  }) {
    const guild =
      this.client.guilds.cache.get(guildId);

    if (!guild) {
      throw new Error(
        "Aether is not installed in this server."
      );
    }

    const state =
      this.getGuildPlayer(guildId);

    switch (command) {
      case "join": {
        if (!payload.voiceChannelId) {
          throw new Error("Select a voice channel first.");
        }

        await this.connect(
          guild,
          payload.voiceChannelId
        );

        return {
          ok: true,
          action: "join",
          connected: true,
          state: this.getState(guildId)
        };
      }


      case "play": {
        const query =
          String(
            payload.query ||
            payload.url ||
            ""
          ).trim();

        if (!query) {
          throw new Error(
            "Play requires a query or URL."
          );
        }

        if (
          payload.voiceChannelId
        ) {
          await this.connect(
            guild,
            payload.voiceChannelId
          );
        }

        if (!state.connection) {
          throw new Error(
            "A voice channel is required."
          );
        }

        const track =
          await this.createTrack(
            query,
            payload.requester || null
          );

        const wasPlaying =
          Boolean(state.current);

        state.queue.push(track);

        if (!wasPlaying) {
          await this.playNext(guildId);
        }

        return {
          ok: true,
          action: "play",
          track,
          queueLength:
            state.queue.length
        };
      }

      case "pause": {
        state.player.pause();

        return {
          ok: true,
          action: "pause"
        };
      }

      case "resume": {
        state.player.unpause();

        return {
          ok: true,
          action: "resume"
        };
      }

      case "skip": {
        state.player.stop();

        return {
          ok: true,
          action: "skip"
        };
      }

      case "stop": {
        state.queue = [];
        state.current = null;
        state.player.stop();

        return {
          ok: true,
          action: "stop"
        };
      }

      case "clear": {
        state.queue = [];

        return {
          ok: true,
          action: "clear"
        };
      }

      case "disconnect": {
        state.queue = [];
        state.current = null;

        state.player.stop();

        if (state.connection) {
          state.connection.destroy();
          state.connection = null;
        }

        return {
          ok: true,
          action: "disconnect"
        };
      }

      case "volume": {
        const volume =
          Number(payload.volume);

        if (
          !Number.isFinite(volume) ||
          volume < 0 ||
          volume > 100
        ) {
          throw new Error(
            "Volume must be between 0 and 100."
          );
        }

        state.volume = volume;

        return {
          ok: true,
          action: "volume",
          volume
        };
      }

      case "repeat": {
        const mode =
          String(
            payload.mode ||
            payload.repeat ||
            "off"
          ).toLowerCase();

        if (
          !["off", "track", "queue"].includes(mode)
        ) {
          throw new Error(
            "Repeat mode must be off, track, or queue."
          );
        }

        state.repeat = mode;

        return {
          ok: true,
          action: "repeat",
          repeat: mode
        };
      }

      case "shuffle": {
        for (
          let i = state.queue.length - 1;
          i > 0;
          i--
        ) {
          const j =
            Math.floor(
              Math.random() * (i + 1)
            );

          [
            state.queue[i],
            state.queue[j]
          ] = [
            state.queue[j],
            state.queue[i]
          ];
        }

        return {
          ok: true,
          action: "shuffle",
          queueLength:
            state.queue.length
        };
      }

      case "previous": {
        throw new Error(
          "Previous is not available until track history is enabled."
        );
      }

      default:
        throw new Error(
          `Unsupported music command: ${command}`
        );
    }
  }

  getState(guildId) {
    const state =
      this.players.get(guildId);

    if (!state) {
      return {
        playing: false,
        paused: false,
        current: null,
        queue: [],
        volume: 80,
        repeat: "off",
        connected: false
      };
    }

    return {
      playing:
        state.player.state.status ===
        AudioPlayerStatus.Playing,

      paused:
        state.player.state.status ===
        AudioPlayerStatus.Paused,

      current: state.current,

      queue: state.queue,

      volume: state.volume,

      repeat: state.repeat,

      connected:
        Boolean(state.connection)
    };
  }

  destroy() {
    for (
      const state of this.players.values()
    ) {
      try {
        state.player.stop();
      } catch {}

      try {
        state.connection?.destroy();
      } catch {}
    }

    this.players.clear();
  }
}
