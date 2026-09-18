/*
 * NEPG Admin
 * Canonical admin panel for NEPG GitHub Pages PWAs.
 *
 * Usage:
 *   NEPGAdmin.open({
 *     appName: "GarageLog",
 *     github: {
 *       owner: "nepg82",
 *       repo: "garagelog",
 *       branch: "main",
 *       token: "...",
 *       rememberToken: true,
 *       onTokenChange(token, remember) { ... }
 *     },
 *     backup: {
 *       exportLocal() { ... },
 *       importLocal(file) { ... }
 *     },
 *     serviceWorker: {
 *       refreshFromServer() { ... }
 *     }
 *   });
 *
 * The admin does not persist credentials itself. The calling PWA owns
 * token storage and supplies the current token at runtime.
 */
(function (global) {
  "use strict";

  const DEFAULTS = {
    appName: "PWA",
    github: {
      owner: "",
      repo: "",
      branch: "main",
      token: "",
      rememberToken: true,
      onTokenChange: null
    },
    backup: {
      exportLocal: null,
      importLocal: null
    },
    serviceWorker: {
      refreshFromServer: null
    }
  };

  let active = null;

  function merge(base, extra) {
    const out = Object.assign({}, base, extra || {});
    Object.keys(base).forEach(function (key) {
      if (base[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
        out[key] = Object.assign({}, base[key], (extra || {})[key] || {});
      }
    });
    return out;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function apiUrl(owner, repo, path) {
    return "https://api.github.com/repos/" +
      encodeURIComponent(owner) + "/" + encodeURIComponent(repo) +
      path;
  }

  async function githubFetch(url, token, options) {
    const opts = Object.assign({}, options || {});
    opts.headers = Object.assign({
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }, opts.headers || {});
    if (token) opts.headers.Authorization = "Bearer " + token;
    const response = await fetch(url, opts);
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      const message = data && data.message ? data.message : ("HTTP " + response.status);
      throw new Error(message);
    }
    return data;
  }

  function makeUI(config) {
    const overlay = document.createElement("div");
    overlay.className = "nepg-admin-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    overlay.innerHTML = `
      <div class="nepg-admin-window">
        <div class="nepg-admin-titlebar">
          <div class="nepg-admin-title">${esc(config.appName)} — NEPG Admin</div>
          <button class="nepg-admin-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="nepg-admin-body">
          <section class="nepg-admin-section">
            <h2>GitHub Settings</h2>
            <div class="nepg-admin-field">
              <label for="nepg-owner">Owner</label>
              <input id="nepg-owner" class="nepg-admin-input" autocomplete="off">
            </div>
            <div class="nepg-admin-field">
              <label for="nepg-repo">Repository</label>
              <input id="nepg-repo" class="nepg-admin-input" autocomplete="off">
            </div>
            <div class="nepg-admin-field">
              <label for="nepg-branch">Branch</label>
              <input id="nepg-branch" class="nepg-admin-input" autocomplete="off">
            </div>
            <div class="nepg-admin-field">
              <label for="nepg-token">PAT</label>
              <input id="nepg-token" class="nepg-admin-input" type="password"
                     autocomplete="off" spellcheck="false">
            </div>
            <label class="nepg-admin-note">
              <input id="nepg-remember" type="checkbox">
              Remember this token on this device
            </label>
            <div class="nepg-admin-note">
              The token is kept by ${esc(config.appName)} in this browser and is
              sent directly to GitHub over HTTPS. NEPG Admin does not save it.
            </div>
            <div class="nepg-admin-actions">
              <button id="nepg-test" class="nepg-admin-button" type="button">Test Connection</button>
              <button id="nepg-save" class="nepg-admin-button" type="button">Save Git Settings</button>
              <button id="nepg-clear" class="nepg-admin-button" type="button">Clear Token</button>
            </div>
            <div id="nepg-git-status" class="nepg-admin-status">Not tested.</div>
          </section>

          <section class="nepg-admin-section">
            <h2>Git Backup</h2>
            <div class="nepg-admin-actions">
              <button id="nepg-backup" class="nepg-admin-button" type="button">Backup to GitHub</button>
              <button id="nepg-restore" class="nepg-admin-button" type="button">Restore from GitHub</button>
            </div>
            <div id="nepg-backup-status" class="nepg-admin-status">Ready.</div>
          </section>

          <section class="nepg-admin-section">
            <h2>Local Safety Hatch</h2>
            <div class="nepg-admin-note">
              Local JSON backup is retained as an emergency fallback if GitHub is unavailable.
            </div>
            <div class="nepg-admin-actions">
              <button id="nepg-export" class="nepg-admin-button" type="button">Export JSON</button>
              <label class="nepg-admin-button" style="display:inline-flex;align-items:center;">
                Import JSON
                <input id="nepg-import" type="file" accept=".json,application/json"
                       style="display:none">
              </label>
            </div>
          </section>

          <section class="nepg-admin-section">
            <h2>App Cache</h2>
            <div class="nepg-admin-note">
              Nuclear option: tell the app to refresh its service-worker/cache state from the server.
            </div>
            <div class="nepg-admin-actions">
              <button id="nepg-refresh" class="nepg-admin-button" type="button">
                Refresh From Server
              </button>
            </div>
            <div id="nepg-cache-status" class="nepg-admin-status">Ready.</div>
          </section>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const q = function (id) { return overlay.querySelector(id); };
    q("#nepg-owner").value = config.github.owner;
    q("#nepg-repo").value = config.github.repo;
    q("#nepg-branch").value = config.github.branch;
    q("#nepg-token").value = config.github.token;
    q("#nepg-remember").checked = config.github.rememberToken;

    function setStatus(selector, message, type) {
      const el = q(selector);
      el.textContent = message;
      el.className = "nepg-admin-status" + (type ? " " + type : "");
    }

    function values() {
      return {
        owner: q("#nepg-owner").value.trim(),
        repo: q("#nepg-repo").value.trim(),
        branch: q("#nepg-branch").value.trim() || "main",
        token: q("#nepg-token").value,
        rememberToken: q("#nepg-remember").checked
      };
    }

    function requireRepo(v) {
      if (!v.owner || !v.repo) throw new Error("Owner and repository are required.");
    }

    async function testConnection() {
      const v = values();
      requireRepo(v);
      const data = await githubFetch(apiUrl(v.owner, v.repo, ""), v.token);
      setStatus("#nepg-git-status",
        "Connected to " + data.full_name + " (" + data.default_branch + ").", "success");
      return data;
    }

    async function saveSettings() {
      const v = values();
      requireRepo(v);
      if (typeof config.github.onTokenChange === "function") {
        await config.github.onTokenChange(v.token, v.rememberToken, {
          owner: v.owner, repo: v.repo, branch: v.branch
        });
      }
      config.github.owner = v.owner;
      config.github.repo = v.repo;
      config.github.branch = v.branch;
      config.github.token = v.token;
      config.github.rememberToken = v.rememberToken;
      setStatus("#nepg-git-status", "Git settings saved.", "success");
    }

    async function run(fn, selector, success) {
      try {
        const result = await fn();
        if (success) setStatus(selector, success, "success");
        return result;
      } catch (error) {
        setStatus(selector, error.message || String(error), "error");
        throw error;
      }
    }

    q("#nepg-test").addEventListener("click", function () {
      run(testConnection, "#nepg-git-status");
    });

    q("#nepg-save").addEventListener("click", function () {
      run(saveSettings, "#nepg-git-status");
    });

    q("#nepg-clear").addEventListener("click", async function () {
      q("#nepg-token").value = "";
      q("#nepg-remember").checked = false;
      if (typeof config.github.onTokenChange === "function") {
        await config.github.onTokenChange("", false, {
          owner: q("#nepg-owner").value.trim(),
          repo: q("#nepg-repo").value.trim(),
          branch: q("#nepg-branch").value.trim() || "main"
        });
      }
      setStatus("#nepg-git-status", "Token cleared.", "success");
    });

    q("#nepg-backup").addEventListener("click", async function () {
      if (typeof config.backup.githubBackup !== "function") {
        setStatus("#nepg-backup-status",
          "This app has not supplied a GitHub backup handler yet.", "error");
        return;
      }
      await run(
        function () { return config.backup.githubBackup(values()); },
        "#nepg-backup-status",
        "Backup completed."
      );
    });

    q("#nepg-restore").addEventListener("click", async function () {
      if (typeof config.backup.githubRestore !== "function") {
        setStatus("#nepg-backup-status",
          "This app has not supplied a GitHub restore handler yet.", "error");
        return;
      }
      await run(
        function () { return config.backup.githubRestore(values()); },
        "#nepg-backup-status",
        "Restore completed."
      );
    });

    q("#nepg-export").addEventListener("click", async function () {
      if (typeof config.backup.exportLocal !== "function") {
        setStatus("#nepg-backup-status",
          "This app has not supplied a local export handler.", "error");
        return;
      }
      try {
        await config.backup.exportLocal();
        setStatus("#nepg-backup-status", "Local JSON export completed.", "success");
      } catch (error) {
        setStatus("#nepg-backup-status", error.message || String(error), "error");
      }
    });

    q("#nepg-import").addEventListener("change", async function (event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      if (typeof config.backup.importLocal !== "function") {
        setStatus("#nepg-backup-status",
          "This app has not supplied a local import handler.", "error");
        return;
      }
      try {
        await config.backup.importLocal(file);
        setStatus("#nepg-backup-status", "Local JSON import completed.", "success");
      } catch (error) {
        setStatus("#nepg-backup-status", error.message || String(error), "error");
      } finally {
        event.target.value = "";
      }
    });

    q("#nepg-refresh").addEventListener("click", async function () {
      if (typeof config.serviceWorker.refreshFromServer !== "function") {
        setStatus("#nepg-cache-status",
          "This app has not supplied a service-worker refresh handler.", "error");
        return;
      }
      try {
        await config.serviceWorker.refreshFromServer();
        setStatus("#nepg-cache-status", "Refresh command sent to the app.", "success");
      } catch (error) {
        setStatus("#nepg-cache-status", error.message || String(error), "error");
      }
    });

    function close() {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      active = null;
    }

    function onKeyDown(event) {
      if (event.key === "Escape") close();
    }

    q(".nepg-admin-close").addEventListener("click", close);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });
    document.addEventListener("keydown", onKeyDown);

    return { close, overlay, values };
  }

  function open(options) {
    if (active) active.close();
    const config = merge(DEFAULTS, options || {});
    active = makeUI(config);
    return active;
  }

  global.NEPGAdmin = { open: open };
})(window);
