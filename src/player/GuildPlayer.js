import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { config } from "../config.js";
import { getGuildSettings } from "../configStore.js";
import { logger } from "../logger.js";
import { resolveStreamUrl, createStreamForTrack, resolveFallbackTrack } from "../sources/index.js";
import { fetchLyrics } from "../util/lyrics.js";
import { shuffleInPlace } from "../util/format.js";
import { buildNowPlayingPayload } from "./nowPlaying.js";

const PLAY_TIMEOUT_MS = 25_000;
const RECONNECT_TIMEOUT_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 5;

export class GuildPlayer {
  constructor(guild) {
    this.guild = guild;
    this.guildId = guild.id;
    this.tracks = [];
    this.history = [];
    this.current = null;
    this.loop = "off";
    const settings = getGuildSettings(this.guildId);
    this.volume = settings.volume;
    this.autoplay = settings.autoplay;
    this.stay247 = settings.stay247;
    this.sleepTimer = null;
    this.connection = null;
    this.channelId = null;
    this.textChannel = null;
    this.controlMessage = null;
    this.forceAdvance = false;
    this.stopped = false;
    this.destroyed = false;
    this.ignoreIdle = false;
    this.reconnectAttempts = 0;
    this.emptyTimer = null;
    this.starting = false;
    this.startedAt = null;       // Date.now() when playback started
    this.pausedAccum = 0;        // total ms spent paused
    this.pauseStarted = null;    // when current pause began
    this.lyrics = null;          // { synced, plain, instrumental }
    this.progressTimer = null;   // interval for live updates

    this.audioPlayer = this.createAudioPlayer();
  }

  createAudioPlayer() {
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    player.on("error", (error) => {
      logger.error(`Playback error in guild ${this.guildId}:`, error);
      const failed = this.current;
      this.forceAdvance = true;
      player.stop(true);
      this.notify(
        failed
          ? `Playback failed for "${failed.title}". Skipping.`
          : "Playback failed. Skipping to the next track.",
      ).catch(() => {});
    });

    player.on(AudioPlayerStatus.Idle, () => {
      if (this.ignoreIdle || this.destroyed || this.starting) return;
      this.handleIdle("finished").catch((error) => logger.error(error));
    });

    return player;
  }

  isPaused() {
    return this.audioPlayer.state.status === AudioPlayerStatus.Paused;
  }

  isPlaying() {
    const status = this.audioPlayer.state.status;
    return status === AudioPlayerStatus.Playing || status === AudioPlayerStatus.Buffering;
  }

  getPositionSec() {
    if (!this.startedAt) return 0;
    let elapsed = Date.now() - this.startedAt - this.pausedAccum;
    if (this.pauseStarted) {
      elapsed -= (Date.now() - this.pauseStarted);
    }
    return Math.max(0, elapsed / 1000);
  }

  startProgressTicker() {
    this.stopProgressTicker();
    this.progressTimer = setInterval(() => {
      if (this.destroyed || !this.current || this.isPaused()) return;
      this.refreshControls().catch(() => {});
    }, 5000); // every 5s for live lyrics + progress
  }

  stopProgressTicker() {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  connect(channel) {
    this.channelId = channel.id;

    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      if (this.connection.joinConfig.channelId !== channel.id) {
        this.connection.rejoin({
          channelId: channel.id,
          selfDeaf: true,
          selfMute: false,
        });
      }
      this.connection.subscribe(this.audioPlayer);
      return this.connection;
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    this.connection = connection;
    this.reconnectAttempts = 0;
    connection.subscribe(this.audioPlayer);
    this.bindConnection(connection);
    return connection;
  }

  bindConnection(connection) {
    connection.on("error", (error) => {
      logger.error(`Voice connection error in guild ${this.guildId}:`, error);
    });

    connection.on(VoiceConnectionStatus.Ready, () => {
      this.reconnectAttempts = 0;
      connection.subscribe(this.audioPlayer);
      logger.info(`Voice ready in guild ${this.guildId}`);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (this.destroyed) return;
      logger.warn(`Voice disconnected in guild ${this.guildId}, attempting reconnect.`);
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, RECONNECT_TIMEOUT_MS),
          entersState(connection, VoiceConnectionStatus.Connecting, RECONNECT_TIMEOUT_MS),
        ]);
      } catch {
        await this.tryReconnect();
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (!this.destroyed) {
        logger.warn(`Voice connection destroyed in guild ${this.guildId}.`);
        this.cleanup();
      }
    });
  }

  async tryReconnect() {
    if (this.destroyed) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      await this.notify("Lost the voice connection after several reconnect attempts. Use /join or /play to start again.");
      this.cleanup();
      return;
    }

    this.reconnectAttempts += 1;
    const channel = this.channelId ? this.guild.channels.cache.get(this.channelId) : null;
    if (!channel || !channel.isVoiceBased()) {
      await this.notify("The voice channel is no longer available.");
      this.cleanup();
      return;
    }

    try {
      const connection = this.connect(channel);
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      if (this.current) {
        await this.playCurrent();
      }
    } catch (error) {
      logger.error(`Reconnect attempt ${this.reconnectAttempts} failed:`, error);
      setTimeout(() => {
        this.tryReconnect().catch((err) => logger.error(err));
      }, 2_000 * this.reconnectAttempts);
    }
  }

  async enqueue(tracks, { interaction, channel }) {
    if (this.destroyed) {
      this.destroyed = false;
      this.audioPlayer = this.createAudioPlayer();
    }

    this.textChannel = interaction.channel ?? this.textChannel;
    const settings = getGuildSettings(this.guildId);
    this.autoplay = settings.autoplay;
    this.stay247 = settings.stay247;
    this.stopped = false;
    this.connect(channel);
    await entersState(this.connection, VoiceConnectionStatus.Ready, 15_000);

    const added = [];
    for (const track of tracks) {
      if (this.tracks.length + (this.current ? 1 : 0) >= config.maxQueueSize) break;
      if (!this.current && !this.isPlaying() && added.length === 0 && this.tracks.length === 0) {
        this.current = track;
      } else {
        this.tracks.push(track);
      }
      added.push(track);
    }

    if (!added.length) {
      throw new Error(`The queue is full (max ${config.maxQueueSize} tracks).`);
    }

    if (this.current && !this.isPlaying() && !this.isPaused()) {
      await this.playCurrent({ updateMessage: false });
    }

    return added;
  }

  async playCurrent({ updateMessage = true } = {}) {
    if (!this.current) return;

    this.starting = true;
    this.ignoreIdle = true;
    this.startedAt = null;
    this.pausedAccum = 0;
    this.pauseStarted = null;
    this.lyrics = null;
    this.stopProgressTicker();

    try {
      let resource;
      const stream = await createStreamForTrack(this.current);
      if (stream) {
        resource = createAudioResource(stream.stream, {
          inputType: stream.type,
          inlineVolume: true,
        });
        if (resource.volume) {
          resource.volume.setVolumeLogarithmic(Math.max(0, Math.min(1, this.volume / 100)));
        }
      } else {
        const streamUrl = await resolveStreamUrl(this.current);
        resource = this.createResource(streamUrl);
      }
      this.audioPlayer.play(resource);
      await entersState(this.audioPlayer, AudioPlayerStatus.Playing, PLAY_TIMEOUT_MS);
      this.startedAt = Date.now();
      logger.info(`Playing "${this.current.title}" in guild ${this.guildId}`);

      // Fire-and-forget lyrics fetch
      fetchLyrics(this.current).then((ly) => {
        this.lyrics = ly;
        this.refreshControls().catch(() => {});
      }).catch(() => {});

      this.startProgressTicker();
    } catch (error) {
      logger.error(`Failed to start "${this.current?.title}":`, error);
      const failed = this.current;
      this.starting = false;
      this.ignoreIdle = false;

      // Automatic source failover: never leave Discord stuck on "thinking".
      if (failed && !failed._aetherFailoverAttempted) {
        failed._aetherFailoverAttempted = true;
        try {
          const fallback = await resolveFallbackTrack(failed, 8000);
          if (fallback) {
            fallback.requestedBy = failed.requestedBy;
            fallback._aetherFailoverAttempted = true;
            this.current = fallback;
            await this.notify(`⚡ **${failed.title}** failed on ${failed.source}. Switching to **${fallback.title}** via ${fallback.source}.`);
            await this.playCurrent({ updateMessage: true });
            return;
          }
        } catch (fallbackError) {
          logger.warn(`Automatic failover failed in guild ${this.guildId}:`, fallbackError.message);
        }
      }

      this.forceAdvance = true;
      await this.notify(`❌ Could not play "${failed?.title || "this track"}". All fallback sources failed. Skipping.`);
      this.handleIdle("error").catch((idleError) => logger.error(idleError));
      return;
    } finally {
      this.starting = false;
      setTimeout(() => {
        this.ignoreIdle = false;
      }, 250);
    }

    if (updateMessage) {
      await this.refreshControls();
    }
  }

  createResource(url) {
    const tryCreate = (inlineVolume) => {
      const resource = createAudioResource(url, {
        inputType: StreamType.Arbitrary,
        inlineVolume,
      });
      if (inlineVolume && resource.volume) {
        resource.volume.setVolumeLogarithmic(Math.max(0, Math.min(1, this.volume / 100)));
      }
      return resource;
    };

    try {
      return tryCreate(true);
    } catch (error) {
      logger.warn("inlineVolume failed, retrying without volume filter.", error.message);
      return tryCreate(false);
    }
  }

  async handleIdle(reason = "finished") {
    this.stopProgressTicker();
    this.lyrics = null;
    if (this.stopped) {
      this.current = null;
      this.refreshControls().catch(() => {});
      return;
    }

    if (this.loop === "track" && this.current && !this.forceAdvance && reason !== "error") {
      this.playCurrent().catch((error) => logger.error(error));
      return;
    }

    this.forceAdvance = false;

    if (this.current) {
      this.history.push(this.current);
      if (this.history.length > 25) this.history.shift();
      if (this.loop === "queue" && reason !== "error") {
        this.tracks.push(this.current);
      }
    }

    this.current = this.tracks.shift() || null;
    if (this.current) {
      this.playCurrent().catch((error) => logger.error(error));
      return;
    }

    if (this.autoplay && this.history.length) {
      const last = this.history[this.history.length - 1];
      try {
        const { resolveFallbackTrack } = await import("../sources/index.js");
        const next = await resolveFallbackTrack(last, 8000);
        if (next) { this.tracks.push(next); this.current = this.tracks.shift(); this.playCurrent().catch((error) => logger.error(error)); return; }
      } catch (error) { logger.warn(`Autoplay failed in guild ${this.guildId}:`, error.message); }
    }

    this.refreshControls().catch(() => {});
  }

  pause() {
    if (!this.current) return "Nothing is playing.";
    const paused = this.audioPlayer.pause(true);
    if (!paused) return "Could not pause playback.";
    this.pauseStarted = Date.now();
    this.stopProgressTicker();
    this.refreshControls().catch(() => {});
    return `Paused **${this.current.title}**.`;
  }

  resume() {
    if (!this.current) return "Nothing is paused.";
    const resumed = this.audioPlayer.unpause();
    if (!resumed) return "Could not resume playback.";
    if (this.pauseStarted) {
      this.pausedAccum += Date.now() - this.pauseStarted;
      this.pauseStarted = null;
    }
    this.startProgressTicker();
    this.refreshControls().catch(() => {});
    return `Resumed **${this.current.title}**.`;
  }

  skip() {
    if (!this.current && this.tracks.length === 0) return "Nothing to skip.";
    this.forceAdvance = true;
    this.audioPlayer.stop(true);
    return "Skipping.";
  }

  previous() {
    if (this.history.length === 0) return "There is no previous track.";
    if (this.current) {
      this.tracks.unshift(this.current);
    }
    this.current = this.history.pop();
    this.ignoreIdle = true;
    this.playCurrent().catch((error) => logger.error(error));
    return `Going back to **${this.current.title}**.`;
  }

  stop() {
    this.stopped = true;
    this.tracks = [];
    this.forceAdvance = false;
    this.stopProgressTicker();
    this.lyrics = null;
    this.audioPlayer.stop(true);
    this.current = null;
    this.refreshControls().catch(() => {});
    return "Stopped playback and cleared the queue.";
  }

  setLoop(mode) {
    this.loop = mode;
    return `Loop mode set to **${mode}**.`;
  }

  setVolume(level) {
    this.volume = level;
    const resource = this.audioPlayer.state.resource;
    if (resource?.volume) {
      resource.volume.setVolumeLogarithmic(Math.max(0, Math.min(1, level / 100)));
    }
    return `Volume set to **${level}%**.`;
  }

  shuffle() {
    if (this.tracks.length < 2) return "Need at least two upcoming tracks to shuffle.";
    shuffleInPlace(this.tracks);
    return `Shuffled ${this.tracks.length} upcoming tracks.`;
  }

  setSleepTimer(minutes) {
    if (this.sleepTimer) { clearTimeout(this.sleepTimer); this.sleepTimer = null; }
    if (!minutes) return;
    this.sleepTimer = setTimeout(() => { this.sleepTimer = null; this.stop(); this.notify("⏱️ Sleep timer ended. Playback stopped.").catch(() => {}); }, minutes * 60_000);
  }

  leave(reason = "Left the voice channel.") {
    this.stopped = true;
    this.tracks = [];
    this.current = null;
    this.audioPlayer.stop(true);
    this.cleanup();
    return reason;
  }

  scheduleEmptyLeave() {
    this.clearEmptyTimer();
    this.emptyTimer = setTimeout(() => {
      if (this.destroyed) return;
      this.notify("Leaving the voice channel because it has been empty.").catch(() => {});
      this.leave();
    }, config.emptyChannelTimeoutMs);
  }

  clearEmptyTimer() {
    if (this.emptyTimer) {
      clearTimeout(this.emptyTimer);
      this.emptyTimer = null;
    }
  }

  cleanup() {
    this.destroyed = true;
    this.clearEmptyTimer();
    if (this.sleepTimer) { clearTimeout(this.sleepTimer); this.sleepTimer = null; }
    this.stopProgressTicker();
    this.lyrics = null;
    this.startedAt = null;
    try {
      this.audioPlayer.stop(true);
    } catch {
      // already stopped
    }
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      try {
        this.connection.destroy();
      } catch {
        // already destroyed
      }
    }
    this.connection = null;
    this.current = null;
    this.tracks = [];
  }

  async refreshControls(interaction) {
    const payload = buildNowPlayingPayload(this);

    if (interaction && !interaction.replied && !interaction.deferred) {
      try {
        this.controlMessage = await interaction.reply({ ...payload, fetchReply: true });
        return;
      } catch {
        // fall through to channel send
      }
    }

    if (interaction && (interaction.deferred || interaction.replied)) {
      try {
        this.controlMessage = await interaction.editReply(payload);
        return;
      } catch {
        // fall through
      }
    }

    if (this.controlMessage) {
      try {
        await this.controlMessage.edit(payload);
        return;
      } catch {
        this.controlMessage = null;
      }
    }

    if (this.textChannel?.send) {
      try {
        this.controlMessage = await this.textChannel.send(payload);
      } catch (error) {
        logger.warn("Could not post now-playing message:", error.message);
      }
    }
  }

  async notify(content) {
    if (!this.textChannel?.send) return;
    try {
      await this.textChannel.send({ content });
    } catch (error) {
      logger.warn("Could not send notification:", error.message);
    }
  }
}
