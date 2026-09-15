let guilds = [];
let g = null;
let s = {};
let originalSettings = {};
let dirty = false;
let messageTimer = null;
let toastTimer = null;

const $ = id => document.getElementById(id);

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    location.href = "/auth/discord";
    throw new Error("Your session expired. Redirecting to login...");
  }

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function normalize(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function setMessage(text, type = "") {
  clearTimeout(messageTimer);

  const el = $("msg");

  if (!text) {
    el.textContent = "";
    el.className = "save-message hidden";
    return;
  }

  el.textContent = text;
  el.className = `save-message ${type}`;

  if (type === "success") {
    messageTimer = setTimeout(() => {
      el.className = "save-message hidden";
      el.textContent = "";
    }, 2800);
  }
}

function toast(text, type = "") {
  clearTimeout(toastTimer);

  const el = $("commandToast");

  el.textContent = text;
  el.className = `toast show ${type}`;

  toastTimer = setTimeout(() => {
    el.className = "toast";
  }, 2400);
}

function markDirty() {
  const current = collect();

  dirty = normalize(current) !== normalize(originalSettings);

  if (dirty) {
    setMessage("Unsaved changes", "warning");
  } else {
    setMessage("");
  }

  $("save").disabled = !dirty;
}

function tab(name) {
  document.querySelectorAll(".tab").forEach(section => {
    section.classList.toggle("active", section.id === name);
  });

  document.querySelectorAll("[data-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === name);
  });

  closeMobileMenu();

  if (name === "analytics") loadAnalytics();
  if (name === "audit") loadAudit();
}

function closeMobileMenu() {
  $("sidebar").classList.remove("mobile-open");
  $("mobileOverlay").classList.remove("show");
  document.body.classList.remove("menu-open");
}

function openMobileMenu() {
  $("sidebar").classList.add("mobile-open");
  $("mobileOverlay").classList.add("show");
  document.body.classList.add("menu-open");
}

document.querySelectorAll("[data-tab]").forEach(button => {
  button.addEventListener("click", () => tab(button.dataset.tab));
});

$("menuButton").addEventListener("click", () => {
  if ($("sidebar").classList.contains("mobile-open")) {
    closeMobileMenu();
  } else {
    openMobileMenu();
  }
});

$("mobileOverlay").addEventListener("click", closeMobileMenu);

const sourceNames = [
  "YouTube",
  "SoundCloud",
  "Spotify",
  "Apple Music",
  "Deezer",
  "Bandcamp",
  "Twitch",
  "Vimeo",
  "Radio",
  "Direct URL"
];

const sourceKeys = [
  "sourceYouTube",
  "sourceSoundCloud",
  "sourceSpotify",
  "sourceAppleMusic",
  "sourceDeezer",
  "sourceBandcamp",
  "sourceTwitch",
  "sourceVimeo",
  "sourceRadio",
  "sourceDirectUrl"
];

function fillSources() {
  $("sources").innerHTML = sourceNames.map((name, index) => {
    const key = sourceKeys[index];

    return `
      <label class="source-card">
        <span>${name}</span>
        <input type="checkbox" data-source="${key}" ${s[key] ? "checked" : ""}>
      </label>
    `;
  }).join("");
}

function fill() {
  [
    "volume",
    "maxQueue",
    "repeat",
    "defaultSearchSource",
    "embedColor",
    "nowPlayingTitle",
    "footerText",
    "djRoleId",
    "musicChannelId",
    "logChannelId"
  ].forEach(key => {
    if ($(key)) {
      $(key).value = s[key] ?? "";
    }
  });

  [
    "autoplay",
    "twentyFourSeven",
    "allowPlaylists",
    "allowSearch",
    "announceNowPlaying",
    "requesterDisplay",
    "showQueueButtons",
    "minDjRole",
    "logCommands",
    "logPlayer"
  ].forEach(key => {
    if ($(key)) {
      $(key).checked = !!s[key];
    }
  });

  fillSources();

  originalSettings = { ...s };
  dirty = false;
  $("save").disabled = true;
  setMessage("");
}

function collect() {
  const result = { ...s };

  [
    "volume",
    "maxQueue",
    "repeat",
    "defaultSearchSource",
    "embedColor",
    "nowPlayingTitle",
    "footerText",
    "djRoleId",
    "musicChannelId",
    "logChannelId"
  ].forEach(key => {
    if ($(key)) {
      result[key] = $(key).value;
    }
  });

  [
    "autoplay",
    "twentyFourSeven",
    "allowPlaylists",
    "allowSearch",
    "announceNowPlaying",
    "requesterDisplay",
    "showQueueButtons",
    "minDjRole",
    "logCommands",
    "logPlayer"
  ].forEach(key => {
    if ($(key)) {
      result[key] = $(key).checked;
    }
  });

  sourceKeys.forEach(key => {
    const input = document.querySelector(`[data-source="${key}"]`);

    if (input) {
      result[key] = input.checked;
    }
  });

  return result;
}

async function loadGuild() {
  try {
    g = guilds.find(server => server.id === $("guild").value);

    if (!g) return;

    $("name").textContent = g.name;

    const meta = await api(`/api/guilds/${g.id}/meta`);

    $("bot").textContent = meta.installed ? "Installed" : "Not installed";
    $("botSub").textContent = meta.installed
      ? "Aether is installed"
      : "Invite Aether to this server";

    $("status").textContent = meta.installed
      ? "Bot connected"
      : "Bot not installed";

    $("status").className = `status ${meta.installed ? "online" : "offline"}`;

    const roles = $("djRoleId");
    const musicChannels = $("musicChannelId");
    const logChannels = $("logChannelId");

    roles.innerHTML = `<option value="">No DJ role</option>`;

    (meta.roles || []).forEach(role => {
      roles.innerHTML += `
        <option value="${role.id}">${escapeHtml(role.name)}</option>
      `;
    });

    musicChannels.innerHTML = `<option value="">Any channel</option>`;
    logChannels.innerHTML = `<option value="">No log channel</option>`;

    (meta.channels || []).forEach(channel => {
      const option = `
        <option value="${channel.id}">
          #${escapeHtml(channel.name)}
        </option>
      `;

      musicChannels.innerHTML += option;
      logChannels.innerHTML += option;
    });

    const voiceChannels = $("voiceChannel");

    if (voiceChannels) {
      voiceChannels.innerHTML =
        `<option value="">Select a voice channel</option>`;

      (meta.channels || [])
        .filter(channel =>
          channel.type === 2 ||
          channel.type === 13
        )
        .forEach(channel => {
          voiceChannels.innerHTML += `
            <option value="${channel.id}">
              ${escapeHtml(channel.name)}
            </option>
          `;
        });
    }

    s = await api(`/api/guilds/${g.id}/settings`);

    fill();

    await player();

  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function player() {
  if (!g) return;

  try {
    const data = await api(`/api/guilds/${g.id}/player`);

    const queue = data.queue || [];

    $("connection").textContent = data.connected
      ? "Connected"
      : "Idle";

    $("connectionPlayer").textContent = data.connected
      ? "Connected"
      : "Idle";

    $("queueCount").textContent = queue.length;
    $("playerQueueCount").textContent =
      `${queue.length} track${queue.length === 1 ? "" : "s"} queued`;

    $("track").textContent =
      data.current?.title || data.track?.title || "Nothing playing";

    if (!queue.length) {
      $("playerQueue").innerHTML = `
        <div class="empty-state">
          No tracks are currently queued.
        </div>
      `;
      return;
    }

    $("playerQueue").innerHTML = queue
      .slice(0, 15)
      .map((item, index) => `
        <div class="queue-row">
          <span class="queue-number">${index + 1}</span>
          <span class="queue-name">
            ${escapeHtml(item?.title || String(item))}
          </span>
        </div>
      `)
      .join("");

  } catch (error) {
    $("track").textContent = "Player unavailable";
  }
}

async function loadAnalytics() {
  if (!g) return;

  try {
    const data = await api(
      `/api/guilds/${g.id}/analytics?days=30`
    );

    const events = data.events || [];

    $("analyticsBox").innerHTML = events.length
      ? events.map(item => `
          <div class="data-row">
            <b>${escapeHtml(item.event_type)}</b>
            <span>${item.count}</span>
          </div>
        `).join("")
      : `<div class="empty-state">No events yet.</div>`;

  } catch (error) {
    $("analyticsBox").textContent = error.message;
  }
}

async function loadAudit() {
  if (!g) return;

  try {
    const data = await api(`/api/guilds/${g.id}/audit`);

    $("auditBox").innerHTML = data.length
      ? data.map(item => `
          <div class="data-row audit-row">
            <div>
              <b>${escapeHtml(item.action)}</b>
              <small>${escapeHtml(item.actor || "Dashboard")}</small>
            </div>
            <span>${new Date(item.created_at).toLocaleString()}</span>
          </div>
        `).join("")
      : `<div class="empty-state">No actions yet.</div>`;

  } catch (error) {
    $("auditBox").textContent = error.message;
  }
}

async function runCommand(command, button) {
  if (!g) return;

  button.disabled = true;

  try {
    const payload = {};
    if (command === "join" || command === "play") payload.voiceChannelId = $("voiceChannel")?.value || null;

    if (command === "volume") {
      payload.volume = Number($("volume").value);
    }

    if (command === "repeat") {
      payload.mode = $("repeat").value;
    }

    await api(
      `/api/guilds/${g.id}/player/${command}`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    );

    toast(`${command.charAt(0).toUpperCase() + command.slice(1)} queued.`, "success");

    setTimeout(player, 300);

  } catch (error) {
    toast(error.message, "error");

  } finally {
    setTimeout(() => {
      button.disabled = false;
    }, 500);
  }
}

document.querySelectorAll("[data-command]").forEach(button => {
  button.addEventListener("click", () => {
    runCommand(button.dataset.command, button);
  });
});

$("guild").addEventListener("change", loadGuild);

$("save").addEventListener("click", async () => {
  if (!g || !dirty) return;

  const button = $("save");
  const text = $("saveText");

  button.disabled = true;
  text.textContent = "Saving...";
  setMessage("");

  try {
    const settings = collect();

    const saved = await api(
      `/api/guilds/${g.id}/settings`,
      {
        method: "PUT",
        body: JSON.stringify(settings)
      }
    );

    s = saved.settings || settings;
    originalSettings = { ...s };
    dirty = false;

    text.textContent = "Saved";
    setMessage("Changes saved.", "success");

    setTimeout(() => {
      text.textContent = "Save changes";
      button.disabled = true;
    }, 1300);

  } catch (error) {
    text.textContent = "Save changes";
    button.disabled = false;
    setMessage(error.message, "error");
  }
});

$("logout").addEventListener("click", async () => {
  try {
    await api("/auth/logout", { method: "POST" });
  } finally {
    location.href = "/";
  }
});

$("invite").addEventListener("click", async () => {
  try {
    const config = await api("/api/public-config");

    if (!config.clientId) {
      throw new Error("Discord Client ID is not configured.");
    }

    const params = new URLSearchParams({
      client_id: config.clientId,
      scope: "bot applications.commands",
      permissions: "0"
    });

    window.open(
      `https://discord.com/oauth2/authorize?${params}`,
      "_blank",
      "noopener,noreferrer"
    );

  } catch (error) {
    toast(error.message, "error");
  }
});

document.addEventListener("input", markDirty);
document.addEventListener("change", markDirty);

window.addEventListener("beforeunload", event => {
  if (!dirty) return;

  event.preventDefault();
  event.returnValue = "";
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

(async () => {
  try {
    const me = await api("/api/me");

    guilds = me.guilds || [];

    if (!guilds.length) {
      throw new Error("No manageable Discord servers found.");
    }

    $("guild").innerHTML = guilds.map(server => `
      <option value="${server.id}">
        ${escapeHtml(server.name)}
        ${server.botInstalled ? "" : " — bot not installed"}
      </option>
    `).join("");

    await loadGuild();

  } catch (error) {
    if (error.message.includes("Redirecting")) return;

    document.body.innerHTML = `
      <main class="error-page">
        <div class="error-card">
          <span class="eyebrow">AETHER</span>
          <h1>Dashboard unavailable</h1>
          <p>${escapeHtml(error.message)}</p>
          <a class="primary" href="/auth/discord">Login with Discord</a>
        </div>
      </main>
    `;
  }
})();
