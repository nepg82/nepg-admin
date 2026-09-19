(function () {
  const D = {
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
      githubBackup: null,
      githubRestore: null,
      exportLocal: null,
      importLocal: null
    },
    serviceWorker: {
      refreshFromServer: null
    }
  };

  function e(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function open(o) {
    o = Object.assign({}, D, o || {});
    o.github = Object.assign({}, D.github, o.github || {});
    o.backup = Object.assign({}, D.backup, o.backup || {});
    o.serviceWorker = Object.assign({}, D.serviceWorker, o.serviceWorker || {});

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
            <div class="nepg-admin-field">
              <label>Owner</label>
              <input id="o" class="nepg-admin-input">
            </div>
            <div class="nepg-admin-field">
              <label>Repository</label>
              <input id="r" class="nepg-admin-input">
            </div>
            <div class="nepg-admin-field">
              <label>Branch</label>
              <input id="b" class="nepg-admin-input">
            </div>
            <div class="nepg-admin-field">
              <label>PAT</label>
              <input id="t" class="nepg-admin-input" type="password">
            </div>
            <label class="nepg-admin-note">
              <input id="m" type="checkbox"> Remember this token on this device
            </label>
            <div class="nepg-admin-note">
              The token is kept by ${e(o.appName)} in this browser and is sent directly to GitHub over HTTPS. NEPG Admin does not save it.
            </div>
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
            <div class="nepg-admin-note">
              Local JSON backup is retained as an emergency fallback if GitHub is unavailable.
            </div>
            <div class="nepg-admin-actions">
              <button id="export" class="nepg-admin-button">Export JSON</button>
              <button id="import" class="nepg-admin-button">Import JSON</button>
            </div>
          </details>

          <details class="nepg-admin-section">
            <summary>App Cache</summary>
            <div class="nepg-admin-note">
              Nuclear option: refresh the app's service-worker/cache state from the server.
            </div>
            <div class="nepg-admin-actions">
              <button id="refresh" class="nepg-admin-button">Refresh From Server</button>
            </div>
            <div id="cs" class="nepg-admin-status">Ready.</div>
          </details>

        </div>
      </div>
    `;

    document.body.appendChild(x);

    x.querySelector("#o").value = o.github.owner;
    x.querySelector("#r").value = o.github.repo;
    x.querySelector("#b").value = o.github.branch;
    x.querySelector("#t").value = o.github.token;
    x.querySelector("#m").checked = o.github.rememberToken;

    const sections = x.querySelectorAll(".nepg-admin-section");
    sections.forEach((section) => {
      section.addEventListener("toggle", () => {
        if (section.open) {
          sections.forEach((other) => {
            if (other !== section) other.open = false;
          });
        }
      });
    });

    const close = () => x.remove();
    x.querySelector(".nepg-admin-close").onclick = close;
    x.onclick = (z) => {
      if (z.target === x) close();
    };

    function note(id, msg) {
      x.querySelector(id).textContent = msg;
    }

    x.querySelector("#test").onclick = () =>
      note("#gs", "Preview only — no GitHub request was made.");

    x.querySelector("#save").onclick = () =>
      note("#gs", "Preview only — settings would be handed back to the PWA.");

    x.querySelector("#clear").onclick = () => {
      x.querySelector("#t").value = "";
      note("#gs", "Preview only — token cleared from the form.");
    };

    x.querySelector("#backup").onclick = () =>
      note("#bs", "Preview only — this would back up the app to its own GitHub repository.");

    x.querySelector("#restore").onclick = () =>
      note("#bs", "Preview only — this would restore the app from its own GitHub repository.");

    x.querySelector("#export").onclick = () =>
      note("#bs", "Preview only — local JSON export would start here.");

    x.querySelector("#import").onclick = () =>
      note("#bs", "Preview only — local JSON import would start here.");

    x.querySelector("#refresh").onclick = () =>
      note("#cs", "Preview only — the app's nuclear service-worker refresh would run here.");
  }

  window.NEPGAdmin = { open };
})();