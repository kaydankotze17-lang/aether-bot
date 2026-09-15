import { GatewayDispatchEvents } from "discord.js";
import { Riffy } from "riffy";

export class AetherMusicManager {
  constructor(client) {
    this.client = client;
    this.players = new Map();

    const host = process.env.LAVALINK_HOST || "127.0.0.1";
    const port = Number(process.env.LAVALINK_PORT || 2333);
    const password =
      process.env.LAVALINK_SERVER_PASSWORD ||
      process.env.LAVALINK_PASSWORD ||
      "youshallnotpass";

    this.riffy = new Riffy(
      client,
      [
        {
          host,
          port,
          password,
          secure:
            String(process.env.LAVALINK_SECURE).toLowerCase() === "true" ||
            port === 443
        }
      ],
      {
        send: payload => {
          const guild = client.guilds.cache.get(
            payload.d.guild_id
          );

          if (guild) {
            guild.shard.send(payload);
          }
        },
        defaultSearchPlatform: "ytmsearch",
        restVersion: "v4"
      }
    );

    client.riffy = this.riffy;

    client.on("raw", packet => {
      if (
        packet.t !==
          GatewayDispatchEvents.VoiceStateUpdate &&
        packet.t !==
          GatewayDispatchEvents.VoiceServerUpdate
      ) {
        return;
      }

      this.riffy.updateVoiceState(packet);
    });

    this.riffy.on("nodeConnect", node => {
      console.log(
        `[AETHER LAVALINK] Node "${node.name}" connected.`
      );
    });

    this.riffy.on("nodeError", (node, error) => {
      console.error(
        `[AETHER LAVALINK] Node "${node.name}" error:`,
        error
      );
    });

    this.riffy.on("nodeDisconnect", node => {
      console.warn(
        `[AETHER LAVALINK] Node "${node.name}" disconnected.`
      );
    });

    this.riffy.on("trackStart", (player, track) => {
      const state = this.getGuildPlayer(player.guildId);

      state.current = this.toTrack(track);

      console.log(
        `[AETHER MUSIC] Playing in ${player.guildId}: ${state.current.title}`
      );
    });

    this.riffy.on("trackEnd", async player => {
      await this.handleTrackEnd(player.guildId);
    });

    this.riffy.on("trackError", async (player, track, error) => {
      console.error(
        `[AETHER MUSIC] Track error in ${player.guildId}:`,
        error
      );

      const state = this.getGuildPlayer(player.guildId);
      state.current = null;

      try {
        await this.playNext(player.guildId);
      } catch (nextError) {
        console.error(
          `[AETHER MUSIC] Queue recovery failed:`,
          nextError
        );
      }
    });

    this.riffy.on("queueEnd", player => {
      const state = this.getGuildPlayer(player.guildId);

      if (state.repeat === "queue" && state.queue.length) {
        for (const track of state.history) {
          state.queue.push(track);
        }

        state.history = [];
        void this.playNext(player.guildId);
        return;
      }

      state.current = null;
      state.playing = false;

      console.log(
        `[AETHER MUSIC] Queue empty in ${player.guildId}`
      );
    });
  }

  getGuildPlayer(guildId) {
    if (!this.players.has(guildId)) {
      this.players.set(guildId, {
        guildId,
        player: null,
        queue: [],
        history: [],
        current: null,
        volume: 80,
        repeat: "off",
        textChannelId: null,
        voiceChannelId: null,
        playing: false,
        paused: false
      });
    }

    return this.players.get(guildId);
  }

  getRiffyPlayer(guildId) {
    return this.riffy.players?.get(String(guildId)) || null;
  }

  toTrack(track, requester = null) {
    if (!track) return null;

    const info = track.info || track;

    return {
      encoded: track.encoded || null,
      url: info.uri || info.url || null,
      title: info.title || "Unknown track",
      author: info.author || null,
      duration: info.length || info.duration || null,
      thumbnail: info.artworkUrl || info.thumbnail || null,
      requester: info.requester || requester || null
    };
  }

  async init() {
    if (!this.client.user) {
      throw new Error("Discord client is not ready.");
    }

    this.riffy.init(this.client.user.id);

    console.log(
      `[AETHER LAVALINK] Connecting to ${process.env.LAVALINK_HOST || "127.0.0.1"}:${process.env.LAVALINK_PORT || 2333}`
    );
  }

  async connect(guild, voiceChannelId, textChannelId = null) {
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

    if (textChannelId) {
      state.textChannelId = String(textChannelId);
    }

    let player = this.getRiffyPlayer(guild.id);

    if (!player) {
      player = this.riffy.createConnection({
        guildId: guild.id,
        voiceChannel: channel.id,
        textChannel: textChannelId
          ? String(textChannelId)
          : null,
        deaf: true
      });

      state.player = player;
    } else if (
      player.voiceChannel !== channel.id
    ) {
      await player.setVoiceChannel(channel.id);
    }

    state.player = player;

    console.log(
      `[AETHER MUSIC] Connected to ${guild.name} / ${channel.name}`
    );

    return player;
  }

  async search(query) {
    const cleanQuery = String(query || "").trim();

    if (!cleanQuery) {
      throw new Error("Search query cannot be empty.");
    }

    const result = await this.riffy.resolve({
      query: cleanQuery,
      requester: null
    });

    if (
      !result ||
      !result.tracks ||
      !result.tracks.length
    ) {
      throw new Error(
        `No music results found for "${cleanQuery}".`
      );
    }

    return result;
  }

  async createTracks(query, requester = null) {
    const cleanQuery = String(query || "").trim();

    if (!cleanQuery) {
      throw new Error("A track query is required.");
    }

    const result = await this.search(
      cleanQuery
    );

    const tracks = result.tracks || [];

    if (!tracks.length) {
      throw new Error(
        `No playable results found for "${cleanQuery}".`
      );
    }

    return tracks.map(track => {
      const converted = this.toTrack(
        track,
        requester
      );

      track.info.requester = requester;

      return {
        source: track,
        ...converted
      };
    });
  }

  async playNext(guildId) {
    const state = this.getGuildPlayer(guildId);
    const player = state.player || this.getRiffyPlayer(guildId);

    if (!player) {
      state.current = null;
      state.playing = false;
      return null;
    }

    if (
      state.repeat === "track" &&
      state.current?.source
    ) {
      player.queue.add(
        state.current.source
      );

      await player.play();

      return state.current;
    }

    const next = state.queue.shift();

    if (!next) {
      state.current = null;
      state.playing = false;
      return null;
    }

    player.queue.add(next.source);

    state.current = next;
    state.playing = true;
    state.paused = false;

    await player.play();

    return next;
  }

  async handleTrackEnd(guildId) {
    const state = this.getGuildPlayer(guildId);

    if (
      state.repeat === "queue" &&
      state.current?.source
    ) {
      state.history.push(
        state.current
      );
    }

    state.current = null;
    state.playing = false;
    state.paused = false;

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
      String(guildId)
    );

    if (!guild) {
      throw new Error(
        "Bot is not in this server."
      );
    }

    switch (command) {
      case "join": {
        const channelId =
          payload.channelId ||
          payload.channel ||
          payload.voiceChannelId;

        await this.connect(
          guild,
          channelId,
          payload.textChannelId
        );

        return {
          message:
            "Connected to the voice channel.",
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
            "Enter a song name or URL."
          );
        }

        const channelId =
          payload.channelId ||
          payload.voiceChannelId ||
          payload.channel;

        if (
          channelId &&
          (
            !state.player ||
            state.voiceChannelId !==
              String(channelId)
          )
        ) {
          await this.connect(
            guild,
            channelId,
            payload.textChannelId
          );
        }

        if (!state.player) {
          throw new Error(
            "Join a voice channel before playing music."
          );
        }

        const tracks =
          await this.createTracks(
            query,
            payload.requester || null
          );

        for (const track of tracks) {
          state.queue.push(track);
        }

        if (
          !state.playing &&
          !state.paused
        ) {
          await this.playNext(guildId);
        }

        const first = tracks[0];

        return {
          message:
            state.current?.url === first.url
              ? `Now playing: ${first.title}`
              : `Added to queue: ${first.title}`,
          track: first,
          added: tracks.length,
          queueLength: state.queue.length,
          playing: state.playing
        };
      }

      case "pause": {
        if (!state.player || !state.playing) {
          throw new Error(
            "Nothing is currently playing."
          );
        }

        state.player.pause();
        state.paused = true;
        state.playing = false;

        return {
          message: "Playback paused."
        };
      }

      case "resume": {
        if (!state.player || !state.paused) {
          throw new Error(
            "Playback is not paused."
          );
        }

        state.player.pause(false);
        state.paused = false;
        state.playing = true;

        return {
          message: "Playback resumed."
        };
      }

      case "skip": {
        if (
          !state.player ||
          (!state.current &&
            !state.queue.length)
        ) {
          throw new Error(
            "There is nothing to skip."
          );
        }

        await state.player.stop();

        return {
          message: "Skipped."
        };
      }

      case "stop": {
        if (state.player) {
          await state.player.stop();
        }

        state.queue = [];
        state.history = [];
        state.current = null;
        state.playing = false;
        state.paused = false;

        return {
          message:
            "Playback stopped and queue cleared."
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
        const previous =
          state.history.pop();

        if (!previous) {
          throw new Error(
            "There is no previous track."
          );
        }

        if (state.current) {
          state.queue.unshift(
            state.current
          );
        }

        state.queue.unshift(
          previous
        );

        if (state.player) {
          await state.player.stop();
        }

        state.current = null;
        state.playing = false;

        await this.playNext(guildId);

        return {
          message:
            `Playing previous: ${previous.title}`
        };
      }

      case "disconnect": {
        if (state.player) {
          try {
            state.player.destroy();
          } catch {}
        }

        this.riffy.players?.delete(
          String(guildId)
        );

        state.player = null;
        state.queue = [];
        state.history = [];
        state.current = null;
        state.playing = false;
        state.paused = false;
        state.voiceChannelId = null;

        return {
          message:
            "Disconnected from voice."
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

        if (state.player) {
          await state.player.setVolume(
            amount
          );
        }

        return {
          message:
            `Volume set to ${amount}%.`,
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
          message:
            `Repeat mode: ${mode}.`,
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
    const state = this.players.get(
      String(guildId)
    );

    if (!state) {
      return null;
    }

    const player =
      state.player ||
      this.getRiffyPlayer(guildId);

    return {
      guildId,
      playing: Boolean(state.playing),
      paused: Boolean(state.paused),
      current: state.current,
      queue: state.queue,
      volume: state.volume,
      repeat: state.repeat,
      connected: Boolean(
        player &&
        player.connected
      ),
      voiceChannelId:
        state.voiceChannelId,
      playerStatus:
        state.paused
          ? "paused"
          : state.playing
            ? "playing"
            : "idle"
    };
  }
}
