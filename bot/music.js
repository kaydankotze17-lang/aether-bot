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
        reconnecting: false
      };

      player.on(
        AudioPlayerStatus.Idle,
        async () => {
          try {
            await this.handleTrackEnd(guildId);
          } catch (error) {
            console.error(
              `[AETHER MUSIC] Track-end error in ${guildId}:`,
              error
            );
          }
        }
      );

      player.on(
        AudioPlayerStatus.Playing,
        () => {
          console.log(
            `[AETHER MUSIC] Player started in ${guildId}`
          );
        }
      );

      player.on(
        AudioPlayerStatus.Paused,
        () => {
          console.log(
            `[AETHER MUSIC] Player paused in ${guildId}`
          );
        }
      );

      player.on(
        "error",
        async error => {
          console.error(
            `[AETHER MUSIC] Player error in ${guildId}:`,
            error
          );

          state.current = null;

          try {
            await this.playNext(guildId);
          } catch (nextError) {
            console.error(
              `[AETHER MUSIC] Failed to continue queue in ${guildId}:`,
              nextError
            );
          }
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
      throw new Error(
        "No voice channel was provided."
      );
    }

    const channel =
      guild.channels.cache.get(
        String(voiceChannelId)
      );

    if (!channel) {
      throw new Error(
        "Voice channel not found."
      );
    }

    if (
      channel.type !== 2 &&
      channel.type !== 13
    ) {
      throw new Error(
        "The selected channel is not a voice channel."
      );
    }

    const state =
      this.getGuildPlayer(guild.id);

    /*
     * Reuse an existing healthy connection.
     */
    if (state.connection) {
      const status =
        state.connection.state.status;

      if (
        status === VoiceConnectionStatus.Ready ||
        status === VoiceConnectionStatus.Connecting ||
        status === VoiceConnectionStatus.Signalling
      ) {
        console.log(
          `[AETHER MUSIC] Already connected to ${guild.name} / ${channel.name}`
        );

        return state.connection;
      }

      try {
        state.connection.destroy();
      } catch {}

      state.connection = null;
    }

    console.log(
      `[AETHER MUSIC] Connecting to ${guild.name} / ${channel.name}`
    );

    const connection =
      joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator:
          guild.voiceAdapterCreator,
        selfDeaf: true
      });

    state.connection = connection;

    connection.subscribe(
      state.player
    );

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
        console.warn(
          `[AETHER MUSIC] Voice connection disconnected in ${guild.name}`
        );

        if (
          state.connection !== connection
        ) {
          return;
        }

        /*
         * Discord voice connections can briefly disconnect
         * while moving between signalling states.
         *
         * Give the connection a short opportunity to recover
         * before destroying it.
         */
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

          console.log(
            `[AETHER MUSIC] Voice connection recovering in ${guild.name}`
          );

          return;
        } catch {}

        /*
         * If recovery failed, cleanly destroy the connection.
         */
        if (
          state.connection === connection
        ) {
          try {
            connection.destroy();
          } catch {}

          state.connection = null;

          console.warn(
            `[AETHER MUSIC] Voice connection closed in ${guild.name}`
          );
        }
      }
    );

    connection.on(
      VoiceConnectionStatus.Destroyed,
      () => {
        if (
          state.connection === connection
        ) {
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
      console.error(
        `[AETHER MUSIC] Failed to establish voice connection in ${guild.name}:`,
        error
      );

      if (
        state.connection === connection
      ) {
        state.connection = null;
      }

      try {
        connection.destroy();
      } catch {}

      throw new Error(
        `Could not connect to ${channel.name}: ${error.message}`
      );
    }

    console.log(
      `[AETHER MUSIC] Connected to ${guild.name} / ${channel.name}`
    );

    return connection;
  }

  async search(query) {
    const cleanQuery =
      String(query || "").trim();

    if (!cleanQuery) {
      throw new Error(
        "Search query cannot be empty."
      );
    }

    console.log(
      `[AETHER MUSIC] Searching YouTube: ${cleanQuery}`
    );

    const results =
      await play.search(
        cleanQuery,
        {
          limit: 5,
          source: {
            youtube: "video"
          }
        }
      );

    if (
      !results ||
      !results.length
    ) {
      throw new Error(
        `No YouTube results found for "${cleanQuery}".`
      );
    }

    const result =
      results.find(
        item =>
          item &&
          item.url
      );

    if (!result) {
      throw new Error(
        `YouTube returned no playable result for "${cleanQuery}".`
      );
    }

    console.log(
      `[AETHER MUSIC] Found: ${result.title || result.url}`
    );

    return result;
  }

  async createTrack(
    query,
    requester = null
  ) {
    const cleanQuery =
      String(query || "").trim();

    if (!cleanQuery) {
      throw new Error(
        "A track query is required."
      );
    }

    let result;

    /*
     * Direct URL.
     */
    if (
      cleanQuery.startsWith(
        "http://"
      ) ||
      cleanQuery.startsWith(
        "https://"
      )
    ) {
      result = {
        url: cleanQuery,
        title: cleanQuery,
        durationRaw: null,
        durationInSec: null,
        thumbnails: []
      };
    } else {
      result =
        await this.search(
          cleanQuery
        );
    }

    return {
      url: result.url,

      title:
        result.title ||
        cleanQuery,

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

  async playTrack(
    state,
    track
  ) {
    if (!state) {
      throw new Error(
        "Player state not found."
      );
    }

    if (!state.connection) {
      throw new Error(
        "The bot is not connected to a voice channel."
      );
    }

    const connectionStatus =
      state.connection.state.status;

    if (
      connectionStatus !==
      VoiceConnectionStatus.Ready
    ) {
      throw new Error(
        `Voice connection is not ready. Current state: ${connectionStatus}`
      );
    }

    if (!track?.url) {
      throw new Error(
        "Track has no playable URL."
      );
    }

    console.log(
      `[AETHER MUSIC] Loading: ${track.title}`
    );

    let stream;

    try {
      stream =
        await play.stream(
          track.url,
          {
            quality: 2,
            discordPlayerCompatibility:
              true
          }
        );
    } catch (error) {
      console.error(
        `[AETHER MUSIC] Stream creation failed for "${track.title}":`,
        error
      );

      throw new Error(
        `Could not create audio stream: ${error.message}`
      );
    }

    if (!stream?.stream) {
      throw new Error(
        "YouTube returned an empty audio stream."
      );
    }

    const inputType =
      stream.type ||
      StreamType.WebmOpus;

    const resource =
      createAudioResource(
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

    state.player.play(
      resource
    );

    console.log(
      `[AETHER MUSIC] Playing: ${track.title}`
    );

    return resource;
  }

  async playNext(guildId) {
    const state =
      this.getGuildPlayer(
        guildId
      );

    if (!state.connection) {
      state.current = null;

      throw new Error(
        "The bot is not connected to a voice channel."
      );
    }

    /*
     * Repeat current track.
     */
    if (
      state.repeat === "track" &&
      state.current
    ) {
      return this.playTrack(
        state,
        state.current
      );
    }

    /*
     * Get next track.
     */
    const next =
      state.queue.shift();

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
        `[AETHER MUSIC] Failed to play "${next.title}":`,
        error
      );

      state.current = null;

      /*
       * Skip the broken track and continue.
       */
      if (
        state.queue.length > 0
      ) {
        console.log(
          `[AETHER MUSIC] Skipping failed track and continuing queue in ${guildId}`
        );

        return this.playNext(
          guildId
        );
      }

      throw error;
    }
  }

  async handleTrackEnd(
    guildId
  ) {
    const state =
      this.players.get(
        guildId
      );

    if (!state) {
      return;
    }

    /*
     * Ignore idle events when there is no current
     * track and no queue.
     */
    if (
      !state.current &&
      !state.queue.length
    ) {
      return;
    }

    /*
     * Repeat one track.
     */
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
          await this.playNext(
            guildId
          );
        } catch (nextError) {
          console.error(
            `[AETHER MUSIC] Failed after repeat error in ${guildId}:`,
            nextError
          );
        }
      }

      return;
    }

    const finished =
      state.current;

    /*
     * Repeat queue means put the finished
     * track back at the end.
     */
    if (
      state.repeat === "queue" &&
      finished
    ) {
      state.queue.push(
        finished
      );
    }

    state.current = null;

    try {
      await this.playNext(
        guildId
      );
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
      this.client.guilds.cache.get(
        String(guildId)
      );

    if (!guild) {
      throw new Error(
        "Aether is not installed in this server."
      );
    }

    const state =
      this.getGuildPlayer(
        guildId
      );

    switch (command) {
      case "join": {
        if (
          !payload.voiceChannelId
        ) {
          throw new Error(
            "Select a voice channel first."
          );
        }

        await this.connect(
          guild,
          payload.voiceChannelId
        );

        return {
          ok: true,
          action: "join",
          connected: true,
          state:
            this.getState(
              guildId
            )
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

        /*
         * Website can send a voice channel
         * together with the play command.
         */
        if (
          payload.voiceChannelId
        ) {
          await this.connect(
            guild,
            payload.voiceChannelId
          );
        }

        if (
          !state.connection
        ) {
          throw new Error(
            "A voice channel is required."
          );
        }

        const track =
          await this.createTrack(
            query,
            payload.requester ||
              null
          );

        const wasPlaying =
          Boolean(
            state.current
          );

        state.queue.push(
          track
        );

        console.log(
          `[AETHER MUSIC] Queued: ${track.title}`
        );

        if (!wasPlaying) {
          await this.playNext(
            guildId
          );
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
        if (
          !state.connection
        ) {
          throw new Error(
            "The bot is not connected."
          );
        }

        state.player.pause();

        return {
          ok: true,
          action: "pause"
        };
      }

      case "resume": {
        if (
          !state.connection
        ) {
          throw new Error(
            "The bot is not connected."
          );
        }

        state.player.unpause();

        return {
          ok: true,
          action: "resume"
        };
      }

      case "skip": {
        if (
          !state.connection
        ) {
          throw new Error(
            "The bot is not connected."
          );
        }

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
          action: "clear",
          queueLength: 0
        };
      }

      case "shuffle": {
        for (
          let i =
            state.queue.length - 1;
          i > 0;
          i--
        ) {
          const j =
            Math.floor(
              Math.random() *
              (i + 1)
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

      case "disconnect": {
        state.queue = [];
        state.current = null;

        state.player.stop();

        if (
          state.connection
        ) {
          try {
            state.connection.destroy();
          } catch {}

          state.connection = null;
        }

        return {
          ok: true,
          action: "disconnect",
          connected: false
        };
      }

      case "volume": {
        const volume =
          Number(
            payload.volume
          );

        if (
          !Number.isFinite(
            volume
          ) ||
          volume < 0 ||
          volume > 100
        ) {
          throw new Error(
            "Volume must be between 0 and 100."
          );
        }

        state.volume =
          volume;

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
          ![
            "off",
            "track",
            "queue"
          ].includes(mode)
        ) {
          throw new Error(
            "Repeat mode must be off, track, or queue."
          );
        }

        state.repeat =
          mode;

        return {
          ok: true,
          action: "repeat",
          repeat: mode
        };
      }

      default:
        throw new Error(
          `Unsupported music command: ${command}`
        );
    }
  }

  getState(guildId) {
    const state =
      this.players.get(
        guildId
      );

    if (!state) {
      return {
        guildId,
        playing: false,
        paused: false,
        current: null,
        queue: [],
        volume: 80,
        repeat: "off",
        connected: false
      };
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

      current:
        state.current,

      queue:
        state.queue,

      volume:
        state.volume,

      repeat:
        state.repeat,

      connected:
        Boolean(
          state.connection &&
          state.connection.state.status ===
            VoiceConnectionStatus.Ready
        )
    };
  }
}
