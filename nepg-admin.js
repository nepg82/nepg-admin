/* NEPG Admin v1.0.0 — shared admin panel + GitHub plumbing for NEPG PWAs */
(function () {
  "use strict";

  const VERSION = "1.0.0";
  const API = "https://api.github.com";
  // Folder this script was loaded from (used to auto-load the CSS + font).
  const BASE = (function () {
    const s = document.currentScript;
    return s && s.src ? s.src.replace(/[^/?#]*([?#].*)?$/, "") : "";
  })();

  const D = {
    appName: "PWA",
    github: {
      owner: "", repo: "", branch: "main",
      token: "",              // seed/fallback token (or the app's own token in storage:"app" mode)
      rememberToken: true,
      storage: "package",     // "package" = NEPG Admin stores it; "app" = app owns storage
      getToken: null,         // app mode: function returning the current token
      onTokenChange: null     // function (token, settings) — fired on save/clear
    },
    data: null,               // {path, get, apply, format?} or an array of them
    backup: { githubBackup: null, githubRestore: null, exportLocal: null, importLocal: null },
    serviceWorker: { refreshFromServer: null },
    onSettingsChange: null
  };

  let CONFIG = {};

  /* ---------- errors & helpers ---------- */
  class NEPGError extends Error {
    constructor(message, status, detail) {
      super(message);
      this.name = "NEPGError";
      this.status = status || 0;
      this.detail = detail;
    }
  }

  const e = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const slug = (v) => String(v || "app").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
  const enc = encodeURIComponent;

  function bytesToB64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64ToBytes(b64) {
    const s = atob(String(b64).replace(/\s/g, ""));
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }
  async function toBytes(c) {
    if (typeof c === "string") return new TextEncoder().encode(c);
    if (c instanceof Uint8Array) return c;
    if (c instanceof ArrayBuffer) return new Uint8Array(c);
    if (c && typeof c.arrayBuffer === "function") return new Uint8Array(await c.arrayBuffer());
    throw new NEPGError("Unsupported content type (use string, Uint8Array, ArrayBuffer, or Blob).");
  }

  function ensureCss() {
    if (!BASE) return;
    const has = [...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /nepg-admin\.css/.test(l.href));
    if (has) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = BASE + "nepg-admin.css";
    (document.head || document.documentElement).appendChild(l);
  }

  /* ---------- GitHub layer ---------- */
  function need(s) {
    if (!s || !s.owner || !s.repo) throw new NEPGError("Owner and repository are required.");
    if (!s.token) throw new NEPGError("No token. Enter a GitHub token first.", 401);
  }

  function httpError(res, data) {
    const m = (data && data.message) || res.statusText || "Request failed";
    let msg;
    if (res.status === 401) msg = "GitHub rejected the token (invalid or expired).";
    else if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") msg = "GitHub rate limit reached. Try again later.";
    else if (res.status === 403) msg = "Token lacks permission. It needs Contents: read & write on this repo.";
    else if (res.status === 404) msg = "Not found. Check owner/repo/branch and that the token has access to this repo.";
    else if (res.status === 409 || res.status === 422) msg = "Conflict: " + m;
    else msg = "GitHub error " + res.status + ": " + m;
    return new NEPGError(msg, res.status, data);
  }

  async function gh(s, method, path, body) {
    need(s);
    let res;
    try {
      res = await fetch(API + path, {
        method,
        cache: "no-store",
        headers: Object.assign({
          Authorization: "Bearer " + s.token,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        }, body ? { "Content-Type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (_) {
      throw new NEPGError("Network error. Check your connection.", 0);
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw httpError(res, data);
    return data;
  }

  const repoPath = (s) => `/repos/${enc(s.owner)}/${enc(s.repo)}`;
  const filePath = (s, p) => `${repoPath(s)}/contents/${String(p).replace(/^\/+/, "").split("/").map(enc).join("/")}`;
  const branchOf = (s) => s.branch || "main";

  async function getMeta(s, path) {
    try {
      return await gh(s, "GET", `${filePath(s, path)}?ref=${enc(branchOf(s))}`);
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async function test(s) {
    const repo = await gh(s, "GET", repoPath(s));
    try {
      await gh(s, "GET", `${repoPath(s)}/branches/${enc(branchOf(s))}`);
    } catch (err) {
      if (err.status === 404) throw new NEPGError(`Branch "${branchOf(s)}" not found in ${repo.full_name}.`, 404);
      throw err;
    }
    return { ok: true, repo: repo.full_name, branch: branchOf(s), private: !!repo.private, canPush: !!(repo.permissions && repo.permissions.push) };
  }

  async function readFile(s, path, opts) {
    const d = await getMeta(s, path);
    if (!d) return null;
    if (Array.isArray(d)) throw new NEPGError(`${path} is a folder, not a file.`);
    let bytes;
    if (d.encoding === "base64" && typeof d.content === "string" && d.content.length) {
      bytes = b64ToBytes(d.content);
    } else if (d.size === 0) {
      bytes = new Uint8Array(0);
    } else {
      // Files over 1 MB come back without content; fetch the blob instead.
      const b = await gh(s, "GET", `${repoPath(s)}/git/blobs/${d.sha}`);
      bytes = b64ToBytes(b.content);
    }
    const binary = opts && opts.binary;
    return { path, sha: d.sha, size: d.size, bytes, text: binary ? undefined : new TextDecoder().decode(bytes) };
  }

  async function writeFile(s, path, content, opts) {
    opts = opts || {};
    const b64 = bytesToB64(await toBytes(content));
    const message = opts.message || `Update ${path}`;
    const put = async (sha) => {
      const body = { message, content: b64, branch: branchOf(s) };
      if (sha) body.sha = sha;
      return gh(s, "PUT", filePath(s, path), body);
    };
    let sha = opts.sha;
    if (sha === undefined) { const m = await getMeta(s, path); sha = m && !Array.isArray(m) ? m.sha : undefined; }
    let r;
    try {
      r = await put(sha);
    } catch (err) {
      // Stale/missing SHA: refetch once and retry (only when we looked it up ourselves).
      if (opts.sha === undefined && (err.status === 409 || err.status === 422)) {
        const m = await getMeta(s, path);
        r = await put(m && !Array.isArray(m) ? m.sha : undefined);
      } else throw err;
    }
    return { path, sha: r.content.sha, commit: r.commit.sha, url: r.content.html_url };
  }

  async function deleteFile(s, path, opts) {
    opts = opts || {};
    const m = opts.sha ? { sha: opts.sha } : await getMeta(s, path);
    if (!m) return { path, deleted: false };
    await gh(s, "DELETE", filePath(s, path), { message: opts.message || `Delete ${path}`, sha: m.sha, branch: branchOf(s) });
    return { path, deleted: true };
  }

  async function listDir(s, path) {
    const d = await getMeta(s, path || "");
    if (!d) return [];
    return (Array.isArray(d) ? d : [d]).map((f) => ({ name: f.name, path: f.path, type: f.type, size: f.size, sha: f.sha }));
  }

  const bound = (s) => ({
    test: () => test(s),
    readFile: (p, o) => readFile(s, p, o),
    writeFile: (p, c, o) => writeFile(s, p, c, o),
    deleteFile: (p, o) => deleteFile(s, p, o),
    listDir: (p) => listDir(s, p)
  });

  /* ---------- config & credential storage ---------- */
  function build(x) {
    const a = CONFIG, b = x || {};
    const o = Object.assign({}, D, a, b);
    ["github", "backup", "serviceWorker"].forEach((k) => { o[k] = Object.assign({}, D[k], a[k] || {}, b[k] || {}); });
    return o;
  }

  const storeKey = (o) => "nepg-admin:v1:" + slug(o.appName);

  function loadStored(o) {
    const k = storeKey(o);
    let c = {}, t = "";
    try { c = JSON.parse(localStorage.getItem(k) || "{}"); } catch (_) {}
    try { t = localStorage.getItem(k + ":token") || sessionStorage.getItem(k + ":token") || ""; } catch (_) {}
    return { owner: c.owner, repo: c.repo, branch: c.branch, remember: c.remember, token: t };
  }

  function persist(o, s) {
    const k = storeKey(o);
    try {
      localStorage.setItem(k, JSON.stringify({ owner: s.owner, repo: s.repo, branch: s.branch, remember: s.rememberToken }));
      localStorage.removeItem(k + ":token");
      sessionStorage.removeItem(k + ":token");
      if (s.token) (s.rememberToken ? localStorage : sessionStorage).setItem(k + ":token", s.token);
    } catch (_) {}
  }

  function wipeToken(o) {
    const k = storeKey(o);
    try { localStorage.removeItem(k + ":token"); sessionStorage.removeItem(k + ":token"); } catch (_) {}
  }

  function resolveSettings(o) {
    const g = o.github;
    if (g.storage === "app") {
      return {
        owner: g.owner, repo: g.repo, branch: g.branch || "main",
        token: (typeof g.getToken === "function" ? g.getToken() : g.token) || "",
        rememberToken: g.rememberToken
      };
    }
    const st = loadStored(o);
    return {
      owner: st.owner || g.owner, repo: st.repo || g.repo, branch: st.branch || g.branch || "main",
      token: st.token || g.token || "",
      rememberToken: st.remember ?? g.rememberToken
    };
  }

  /* ---------- data helpers (backup / restore / export / import) ---------- */
  function dataFiles(o) {
    const d = o.data;
    if (!d) return [];
    return Array.isArray(d) ? d : d.files ? d.files : [d];
  }
  async function serialize(f) {
    if (typeof f.get !== "function") throw new NEPGError(`data.get() is missing for ${f.path}.`);
    const v = await f.get();
    return f.format === "text" || typeof v === "string" ? String(v) : JSON.stringify(v, null, 2);
  }
  function parseRemote(f, text) {
    if (f.format === "text") return text;
    try { return JSON.parse(text); } catch (_) { throw new NEPGError(`${f.path} is not valid JSON.`); }
  }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");

  /* ---------- panel ---------- */
  function panel(o, auth) {
    ensureCss();
    return new Promise((resolve) => {
      const g = o.github;
      const start = resolveSettings(o);
      const x = document.createElement("div");
      x.className = "nepg-admin-overlay";
      x.innerHTML = `
      <div class="nepg-admin-window">
        <div class="nepg-admin-titlebar">
          <div class="nepg-admin-title">${e(o.appName)} — NEPG Admin</div>
          <button class="nepg-admin-close">×</button>
        </div>
        <div class="nepg-admin-body">
          <details class="nepg-admin-section">
            <summary>GitHub Settings</summary>
            ${auth ? '<div class="nepg-admin-note">Sign in to continue. Enter a token with Contents: read &amp; write on this repo.</div>' : ""}
            <div class="nepg-admin-field"><label>Owner</label><input id="o" class="nepg-admin-input"></div>
            <div class="nepg-admin-field"><label>Repository</label><input id="r" class="nepg-admin-input"></div>
            <div class="nepg-admin-field"><label>Branch</label><input id="b" class="nepg-admin-input"></div>
            <div class="nepg-admin-field"><label>PAT</label><input id="t" class="nepg-admin-input" type="password" autocomplete="off"></div>
            <label class="nepg-admin-note"><input id="m" type="checkbox"> Remember this token on this device</label>
            <div class="nepg-admin-note">${g.storage === "app"
              ? `The token is kept by ${e(o.appName)} and sent directly to GitHub over HTTPS. NEPG Admin does not save it.`
              : "The token is stored in this browser only and sent directly to GitHub over HTTPS."}</div>
            <div class="nepg-admin-actions">
              <button id="test" class="nepg-admin-button">Test Connection</button>
              <button id="save" class="nepg-admin-button">Save Git Settings</button>
              <button id="clear" class="nepg-admin-button">Clear Token</button>
            </div>
            <div id="gs" class="nepg-admin-status">Not tested.</div>
          </details>
          <details class="nepg-admin-section">
            <summary>Git Backup</summary>
            <div class="nepg-admin-actions">
              <button id="backup" class="nepg-admin-button">Backup to GitHub</button>
              <button id="restore" class="nepg-admin-button">Restore from GitHub</button>
            </div>
            <div id="bs" class="nepg-admin-status">Ready.</div>
          </details>
          <details class="nepg-admin-section">
            <summary>Local Safety Hatch</summary>
            <div class="nepg-admin-note">Local JSON backup is retained as an emergency fallback if GitHub is unavailable.</div>
            <div class="nepg-admin-actions">
              <button id="export" class="nepg-admin-button">Export JSON</button>
              <button id="import" class="nepg-admin-button">Import JSON</button>
              <input id="file" class="nepg-admin-hidden" type="file" accept=".json,application/json">
            </div>
            <div id="ls" class="nepg-admin-status">Ready.</div>
          </details>
          <details class="nepg-admin-section">
            <summary>App Cache</summary>
            <div class="nepg-admin-note">Nuclear option: refresh the app's service-worker/cache state from the server.</div>
            <div class="nepg-admin-actions">
              <button id="refresh" class="nepg-admin-button">Refresh From Server</button>
            </div>
            <div id="cs" class="nepg-admin-status">Ready.</div>
          </details>
        </div>
      </div>`;
      document.body.appendChild(x);

      const q = (s) => x.querySelector(s);
      q("#o").value = start.owner || "";
      q("#r").value = start.repo || "";
      q("#b").value = start.branch || "main";
      q("#t").value = start.token || "";
      q("#m").checked = !!start.rememberToken;

      const sections = x.querySelectorAll(".nepg-admin-section");
      sections.forEach((sec) => sec.addEventListener("toggle", () => {
        if (sec.open) sections.forEach((other) => { if (other !== sec) other.open = false; });
      }));
      if (auth || !start.token) sections[0].open = true;

      let done = false;
      const onKey = (ev) => { if (ev.key === "Escape") close(); };
      function finish(err, val) {
        if (done) return;
        done = true;
        x.remove();
        document.removeEventListener("keydown", onKey);
        if (auth) { err ? auth.rej(err) : auth.res(val); }
        resolve();
      }
      function close() { finish(new NEPGError("Sign-in cancelled.", 0, "cancelled")); }
      document.addEventListener("keydown", onKey);
      q(".nepg-admin-close").onclick = close;
      x.onclick = (z) => { if (z.target === x) close(); };

      const form = () => ({
        owner: q("#o").value.trim(), repo: q("#r").value.trim(),
        branch: q("#b").value.trim() || "main",
        token: q("#t").value.trim(), rememberToken: q("#m").checked
      });
      function say(id, msg, cls) {
        const n = q(id);
        n.textContent = msg;
        n.className = "nepg-admin-status" + (cls ? " " + cls : "");
      }
      async function run(id, work) {
        const btns = x.querySelectorAll("button.nepg-admin-button");
        btns.forEach((b) => (b.disabled = true));
        say(id, "Working…");
        try { await work(); }
        catch (err) { say(id, (err && err.message) || String(err), "error"); }
        finally { btns.forEach((b) => (b.disabled = false)); }
      }

      q("#test").onclick = () => run("#gs", async () => {
        const r = await test(form());
        say("#gs", `Connected to ${r.repo} (${r.branch}).` + (r.canPush ? " Write access confirmed." : " WARNING: token looks read-only."), r.canPush ? "success" : "error");
      });

      q("#save").onclick = () => run("#gs", async () => {
        const s = form();
        if (g.storage !== "app") persist(o, s);
        if (typeof g.onTokenChange === "function") g.onTokenChange(s.token, s);
        if (typeof o.onSettingsChange === "function") o.onSettingsChange(s);
        let r;
        try { r = await test(s); }
        catch (err) { say("#gs", "Saved, but connection failed: " + err.message, "error"); return; }
        say("#gs", `Saved. Connected to ${r.repo}.` + (r.canPush ? "" : " WARNING: token looks read-only."), r.canPush ? "success" : "error");
        if (auth && r.canPush) finish(null, s);
      });

      q("#clear").onclick = () => {
        q("#t").value = "";
        if (g.storage !== "app") wipeToken(o);
        if (typeof g.onTokenChange === "function") g.onTokenChange("", form());
        say("#gs", "Token cleared.", "success");
      };

      q("#backup").onclick = () => run("#bs", async () => {
        const s = form();
        if (o.backup.githubBackup) {
          await o.backup.githubBackup(s, bound(s));
          say("#bs", "Backup complete.", "success");
          return;
        }
        const files = dataFiles(o);
        if (!files.length) throw new NEPGError("No data configured. The app must supply data {path,get,apply} or backup.githubBackup.");
        const message = `${o.appName}: backup ${new Date().toISOString()}`;
        for (let i = 0; i < files.length; i++) {
          say("#bs", `Uploading ${i + 1}/${files.length}: ${files[i].path}…`);
          await writeFile(s, files[i].path, await serialize(files[i]), { message });
        }
        say("#bs", `Backed up ${files.length} file(s) to ${s.owner}/${s.repo}.`, "success");
      });

      q("#restore").onclick = () => run("#bs", async () => {
        const s = form();
        if (!window.confirm("Replace this app's local data with the copy on GitHub?")) { say("#bs", "Restore cancelled."); return; }
        if (o.backup.githubRestore) {
          await o.backup.githubRestore(s, bound(s));
          say("#bs", "Restore complete.", "success");
          return;
        }
        const files = dataFiles(o);
        if (!files.length) throw new NEPGError("No data configured. The app must supply data {path,get,apply} or backup.githubRestore.");
        const loaded = [];
        for (let i = 0; i < files.length; i++) {          // read everything first so a failure can't half-apply
          say("#bs", `Downloading ${i + 1}/${files.length}: ${files[i].path}…`);
          if (typeof files[i].apply !== "function") throw new NEPGError(`data.apply() is missing for ${files[i].path}.`);
          const r = await readFile(s, files[i].path);
          if (!r) throw new NEPGError(`${files[i].path} was not found in ${s.owner}/${s.repo}.`, 404);
          loaded.push(parseRemote(files[i], r.text));
        }
        for (let i = 0; i < files.length; i++) await files[i].apply(loaded[i]);
        say("#bs", `Restored ${files.length} file(s) from GitHub.`, "success");
      });

      q("#export").onclick = () => run("#ls", async () => {
        if (o.backup.exportLocal) { await o.backup.exportLocal(); say("#ls", "Export complete.", "success"); return; }
        const files = dataFiles(o);
        if (!files.length) throw new NEPGError("No data configured. The app must supply data or backup.exportLocal.");
        let text;
        if (files.length === 1) text = await serialize(files[0]);
        else {
          const bundle = {};
          for (const f of files) bundle[f.path] = f.format === "text" ? await serialize(f) : JSON.parse(await serialize(f));
          text = JSON.stringify(bundle, null, 2);
        }
        download(`${slug(o.appName)}-backup-${stamp()}.json`, text);
        say("#ls", "Export started.", "success");
      });

      q("#import").onclick = () => q("#file").click();
      q("#file").onchange = (ev) => {
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = "";
        if (!file) return;
        run("#ls", async () => {
          if (!window.confirm(`Replace this app's local data with ${file.name}?`)) { say("#ls", "Import cancelled."); return; }
          if (o.backup.importLocal) { await o.backup.importLocal(file); say("#ls", "Import complete.", "success"); return; }
          const files = dataFiles(o);
          if (!files.length) throw new NEPGError("No data configured. The app must supply data or backup.importLocal.");
          let parsed;
          try { parsed = JSON.parse(await file.text()); } catch (_) { throw new NEPGError("That file is not valid JSON."); }
          if (files.length === 1) await files[0].apply(parsed);
          else {
            for (const f of files) if (!(f.path in parsed)) throw new NEPGError(`Backup is missing ${f.path}.`);
            for (const f of files) await f.apply(parsed[f.path]);
          }
          say("#ls", "Import complete.", "success");
        });
      };

      q("#refresh").onclick = () => run("#cs", async () => {
        if (o.serviceWorker.refreshFromServer) { await o.serviceWorker.refreshFromServer(); say("#cs", "Refresh complete.", "success"); return; }
        say("#cs", "Clearing service workers and caches…");
        if (navigator.serviceWorker) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        say("#cs", "Cleared. Reloading…", "success");
        setTimeout(() => location.reload(), 500);
      });
    });
  }

  /* ---------- public API ---------- */
  function init(c) { CONFIG = c || {}; return api; }
  function open(opts) { return panel(build(opts), null); }
  function getSettings(opts) { return resolveSettings(build(opts)); }
  function client(opts) { return bound(resolveSettings(build(opts))); }
  function clearToken(opts) {
    const o = build(opts);
    if (o.github.storage !== "app") wipeToken(o);
    if (typeof o.github.onTokenChange === "function") o.github.onTokenChange("", resolveSettings(o));
  }

  // Resolves with settings once a usable token exists; opens the panel (GitHub section) if not.
  // opts: any open() options, plus force (always prompt) and verify (test the stored token first).
  async function requireAuth(opts) {
    opts = opts || {};
    const o = build(opts);
    const s = resolveSettings(o);
    if (!opts.force && s.token && s.owner && s.repo) {
      if (!opts.verify) return s;
      try { await test(s); return s; } catch (err) { if (err.status === 0) return s; }
    }
    return new Promise((res, rej) => panel(o, { res, rej }));
  }

  // Convenience: sign in if needed, write the file, and re-prompt once if GitHub rejects the token.
  async function push(path, content, opts) {
    opts = opts || {};
    let s = await requireAuth(opts.admin);
    try {
      return await writeFile(s, path, content, opts);
    } catch (err) {
      if (err.status !== 401) throw err;
      s = await requireAuth(Object.assign({}, opts.admin, { force: true }));
      return writeFile(s, path, content, opts);
    }
  }

  const api = {
    version: VERSION,
    init, open, requireAuth, push, getSettings, client, clearToken,
    github: { test, readFile, writeFile, deleteFile, listDir },
    NEPGError
  };
  window.NEPGAdmin = api;
})();
