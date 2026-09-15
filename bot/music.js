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
        textChannelId: null,
        voiceChannelId: null,
        reconnecting: false,
        starting: false
      };

      player.on(AudioPlayerStatus.Playing, () => {
        console.log(
          `[AETHER MUSIC] Playing in ${guildId}: ${state.current?.title || "unknown"}`
        );
      });

      player.on(AudioPlayerStatus.Paused, () => {
        console.log(
          `[AETHER MUSIC] Paused in ${guildId}`
        );
      });

      player.on(AudioPlayerStatus.Idle, async () => {
        if (state.starting) return;

        try {
          await this.handleTrackEnd(guildId);
        } catch (error) {
          console.error(
            `[AETHER MUSIC] Track ended with error in ${guildId}:`,
            error
          );
        }
      });

      player.on("error", async error => {
        console.error(
          `[AETHER MUSIC] Audio player error in ${guildId}:`,
          error
        );

        state.current = null;
        state.starting = false;

        try {
          await this.playNext(guildId);
        } catch (nextError) {
          console.error(
            `[AETHER MUSIC] Queue recovery failed in ${guildId}:`,
            nextError
          );
        }
      });

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

    const channel = guild.channels.cache.get(
      String(voiceChannelId)
    );

    if (!channel) {
      throw new Error("Voice channel not found.");
    }

    if (channel.type !== 2 && channel.type !== 13) {
      throw new Error(
        "The selected channel is not a voice channel."
      );
    }

    const state = this.getGuildPlayer(guild.id);
    state.voiceChannelId = channel.id;

    if (state.connection) {
      const status = state.connection.state.status;

      if (status === VoiceConnectionStatus.Ready) {
        state.connection.subscribe(state.player);
        return state.connection;
      }

      if (
        status === VoiceConnectionStatus.Connecting ||
        status === VoiceConnectionStatus.Signalling
      ) {
        try {
          await entersState(
            state.connection,
            VoiceConnectionStatus.Ready,
            10000
          );

          state.connection.subscribe(state.player);
          return state.connection;
        } catch {
          try {
            state.connection.destroy();
          } catch {}

          state.connection = null;
        }
      }
    }

    console.log(
      `[AETHER MUSIC] Connecting to ${guild.name} / ${channel.name}`
    );

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });

    state.connection = connection;
    connection.subscribe(state.player);

    connection.on(
      VoiceConnectionStatus.Ready,
      () => {
        state.reconnecting = false;

        console.log(
          `[AETHER MUSIC] Voice connection ready in ${guild.name}`
        );
      }
    );

    connection.on(
      VoiceConnectionStatus.Disconnected,
      async () => {
        if (state.connection !== connection) {
          return;
        }

        console.warn(
          `[AETHER MUSIC] Voice disconnected in ${guild.name}`
        );

        if (state.reconnecting) {
          return;
        }

        state.reconnecting = true;

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

          await entersState(
            connection,
            VoiceConnectionStatus.Ready,
            10000
          );

          state.reconnecting = false;

          console.log(
            `[AETHER MUSIC] Voice connection recovered in ${guild.name}`
          );
        } catch (error) {
          console.error(
            `[AETHER MUSIC] Voice recovery failed in ${guild.name}:`,
            error
          );

          state.reconnecting = false;

          if (state.connection === connection) {
            try {
              connection.destroy();
            } catch {}

            state.connection = null;
          }
        }
      }
    );

    connection.on(
      VoiceConnectionStatus.Destroyed,
      () => {
        if (state.connection === connection) {
          state.connection = null;
        }

        console.log(
          `[AETHER MUSIC] Voice connection destroyed in ${guild.name}`
        );
      }
    );

    try {
      await entersState(
        connection,
        VoiceConnectionStatus.Ready,
        15000
      );
    } catch (error) {
      if (state.connection === connection) {
        state.connection = null;
      }

      try {
        connection.destroy();
      } catch {}

      throw new Error(
        `Could not connect to ${channel.name}: ${error.message}`
      );
    }

    return connection;
  }

  async search(query) {
    const cleanQuery = String(query || "").trim();

    if (!cleanQuery) {
      throw new Error("Search query cannot be empty.");
    }

    console.log(
      `[AETHER MUSIC] YouTube search: ${cleanQuery}`
    );

    const results = await play.search(
      cleanQuery,
      {
        limit: 5,
        source: {
          youtube: "video"
        }
      }
    );

    if (!results?.length) {
      throw new Error(
        `No YouTube results found for "${cleanQuery}".`
      );
    }

    const result = results.find(
      item => item?.url
    );

    if (!result) {
      throw new Error(
        `No playable YouTube result found for "${cleanQuery}".`
      );
    }

    return result;
  }

  async createTrack(query, requester = null) {
    const cleanQuery = String(query || "").trim();

    if (!cleanQuery) {
      throw new Error("A track query is required.");
    }

    let result;

    if (
      cleanQuery.startsWith("http://") ||
      cleanQuery.startsWith("https://")
    ) {
      result = {
        url: cleanQuery,
        title: cleanQuery,
        durationRaw: null,
        durationInSec: null,
        thumbnails: []
      };
    } else {
      result = await this.search(cleanQuery);
    }

    return {
      url: result.url,
      title: result.title || cleanQuery,
      duration:
        result.durationRaw ||
        result.durationInSec ||
        null,
      thumbnail:
        result.thumbnails?.[0]?.url ||
        result.thumbnail ||
        null,
      requester
    };
  }

  async playTrack(state, track) {
    if (!state) {
      throw new Error("Player state not found.");
    }

    if (!state.connection) {
      throw new Error(
        "Aether is not connected to a voice channel."
      );
    }

    if (
      state.connection.state.status !==
      VoiceConnectionStatus.Ready
    ) {
      throw new Error(
        `Voice connection is not ready: ${state.connection.state.status}`
      );
    }

    if (!track?.url) {
      throw new Error("Track has no playable URL.");
    }

    state.starting = true;

    console.log(
      `[AETHER MUSIC] Creating stream: ${track.title}`
    );

    try {
      const stream = await play.stream(
        track.url,
        {
          quality: 2,
          discordPlayerCompatibility: true
        }
      );

      if (!stream?.stream) {
        throw new Error(
          "The music source returned no audio stream."
        );
      }

      const inputType =
        stream.type || StreamType.WebmOpus;

      const resource = createAudioResource(
        stream.stream,
        {
          inputType,
          inlineVolume: true
        }
      );

      if (resource.volume) {
        resource.volume.setVolume(
          Math.max(
            0,
            Math.min(
              100,
              Number(state.volume) || 0
            )
          ) / 100
        );
      }

      state.current = track;

      state.player.play(resource);

      await entersState(
        state.player,
        AudioPlayerStatus.Playing,
        10000
      );

      state.starting = false;

      console.log(
        `[AETHER MUSIC] Audio started: ${track.title}`
      );

      return resource;
    } catch (error) {
      state.starting = false;
      state.current = null;

      console.error(
        `[AETHER MUSIC] Playback failed for "${track.title}":`,
        error
      );

      throw new Error(
        `Playback failed: ${error.message}`
      );
    }
  }

  async playNext(guildId) {
    const state = this.getGuildPlayer(guildId);

    if (!state.connection) {
      state.current = null;
      return null;
    }

    if (
      state.repeat === "track" &&
      state.current
    ) {
      return this.playTrack(
        state,
        state.current
      );
    }

    const next = state.queue.shift();

    if (!next) {
      state.current = null;

      console.log(
        `[AETHER MUSIC] Queue empty in ${guildId}`
      );

      return null;
    }

    try {
      return await this.playTrack(
        state,
        next
      );
    } catch (error) {
      console.error(
        `[AETHER MUSIC] Skipping failed track "${next.title}":`,
        error
      );

      state.current = null;

      if (state.queue.length) {
        return this.playNext(guildId);
      }

      throw error;
    }
  }

  async handleTrackEnd(guildId) {
    const state = this.players.get(guildId);

    if (!state) {
      return;
    }

    if (
      state.repeat === "track" &&
      state.current
    ) {
      try {
        await this.playTrack(
          state,
          state.current
        );
      } catch (error) {
        console.error(
          `[AETHER MUSIC] Repeat failed in ${guildId}:`,
          error
        );

        state.current = null;

        try {
          await this.playNext(guildId);
        } catch {}
      }

      return;
    }

    const finished = state.current;
    state.current = null;

    if (
      state.repeat === "queue" &&
      finished
    ) {
      state.queue.push(finished);
    }

    try {
      await this.playNext(guildId);
    } catch (error) {
      console.error(
        `[AETHER MUSIC] Could not play next track in ${guildId}:`,
        error
      );
    }
  }

  async handleCommand({
    guildId,
    command,
    payload = {}
  }) {
    const state = this.getGuildPlayer(guildId);

    const guild = this.client.guilds.cache.get(
      guildId
    );

    if (!guild) {
      throw new Error("Bot is not in this server.");
    }

    switch (command) {
      case "join": {
        const channelId =
          payload.channelId ||
          payload.channel ||
          payload.voiceChannelId;

        await this.connect(
          guild,
          channelId
        );

        return {
          message: "Connected to the voice channel.",
          connected: true
        };
      }

      case "play": {
        const query =
          payload.query ||
          payload.url ||
          payload.song;

        if (!query) {
          throw new Error(
            "Enter a song name or YouTube URL."
          );
        }

        const channelId =
          payload.channelId ||
          payload.voiceChannelId ||
          payload.channel;

        if (
          channelId &&
          (
            !state.connection ||
            state.voiceChannelId !== String(channelId)
          )
        ) {
          await this.connect(
            guild,
            channelId
          );
        }

        if (!state.connection) {
          throw new Error(
            "Join a voice channel before playing music."
          );
        }

        const track =
          await this.createTrack(
            query,
            payload.requester || null
          );

        state.queue.push(track);

        if (
          !state.current &&
          state.player.state.status !==
          AudioPlayerStatus.Playing
        ) {
          await this.playNext(guildId);
        }

        return {
          message:
            state.current?.url === track.url
              ? `Now playing: ${track.title}`
              : `Added to queue: ${track.title}`,
          track,
          queueLength: state.queue.length,
          playing: Boolean(state.current)
        };
      }

      case "pause": {
        if (
          state.player.state.status !==
          AudioPlayerStatus.Playing
        ) {
          throw new Error(
            "Nothing is currently playing."
          );
        }

        state.player.pause();

        return {
          message: "Playback paused."
        };
      }

      case "resume": {
        if (
          state.player.state.status !==
          AudioPlayerStatus.Paused
        ) {
          throw new Error(
            "Playback is not paused."
          );
        }

        state.player.unpause();

        return {
          message: "Playback resumed."
        };
      }

      case "skip": {
        if (!state.current && !state.queue.length) {
          throw new Error(
            "There is nothing to skip."
          );
        }

        state.player.stop(true);

        return {
          message: "Skipped."
        };
      }

      case "stop": {
        state.queue = [];
        state.current = null;
        state.player.stop(true);

        return {
          message: "Playback stopped and queue cleared."
        };
      }

      case "clear": {
        state.queue = [];

        return {
          message: "Queue cleared."
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
          message: "Queue shuffled."
        };
      }

      case "previous": {
        throw new Error(
          "Previous track is not available yet."
        );
      }

      case "disconnect": {
        state.queue = [];
        state.current = null;
        state.player.stop(true);

        if (state.connection) {
          try {
            state.connection.destroy();
          } catch {}

          state.connection = null;
        }

        state.voiceChannelId = null;

        return {
          message: "Disconnected from voice."
        };
      }

      case "volume": {
        const amount = Number(
          payload.amount ??
          payload.volume
        );

        if (
          !Number.isFinite(amount) ||
          amount < 0 ||
          amount > 100
        ) {
          throw new Error(
            "Volume must be between 0 and 100."
          );
        }

        state.volume = amount;

        return {
          message: `Volume set to ${amount}%.`,
          volume: amount
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
          ![
            "off",
            "track",
            "queue"
          ].includes(mode)
        ) {
          throw new Error(
            "Repeat must be off, track, or queue."
          );
        }

        state.repeat = mode;

        return {
          message: `Repeat mode: ${mode}.`,
          repeat: mode
        };
      }

      default:
        throw new Error(
          `Unknown music command: ${command}`
        );
    }
  }

  getState(guildId) {
    const state = this.players.get(guildId);

    if (!state) {
      return null;
    }

    const playerStatus =
      state.player.state.status;

    return {
      guildId,
      playing:
        playerStatus ===
        AudioPlayerStatus.Playing,
      paused:
        playerStatus ===
        AudioPlayerStatus.Paused,
      current: state.current,
      queue: state.queue,
      volume: state.volume,
      repeat: state.repeat,
      connected: Boolean(
        state.connection &&
        state.connection.state.status ===
        VoiceConnectionStatus.Ready
      ),
      voiceChannelId:
        state.voiceChannelId,
      playerStatus
    };
  }
}
