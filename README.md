# NEPG Admin

Canonical administration panel + GitHub plumbing for NEPG's GitHub Pages PWAs.

## Files
- `nepg-admin.js` — panel, GitHub client, token storage. Auto-loads the CSS from its own folder.
- `nepg-admin.css` — Mac OS-style UI. Expects `fonts/ChiKareGo2.ttf` next to it.

Integration is one tag: `<script src="https://nepg82.github.io/<admin-repo>/nepg-admin.js"></script>`
(The CSS and font resolve relative to that URL. Add all three to each app's service worker cache.)

## Quick start

```js
NEPGAdmin.init({
  appName: "GarageLog",
  github: { owner: "nepg82", repo: "garagelog", branch: "main" },
  data: {                                   // one file, or an array of them
    path: "data/garagelog.json",
    get:   () => myState,                   // may be async; objects are JSON-stringified
    apply: (obj) => { myState = obj; render(); }
  }
});

NEPGAdmin.open();                           // admin button / hidden gesture
```

With `data` supplied, the panel's Backup, Restore, Export JSON and Import JSON all work with no further code.
The data file is written exactly as `get()` returns it (no wrapper), so existing repo data keeps its format.
`format: "text"` on a data entry skips JSON handling. Several entries are exported/imported as one bundle keyed by path.

## On-demand login (apps that only show admin when a push happens)

```js
// Option A: gate it yourself
const s = await NEPGAdmin.requireAuth();    // resolves immediately if a token exists, else opens the panel
await NEPGAdmin.client().writeFile("data/x.json", json, { message: "Add entry" });

// Option B: one call (signs in if needed, re-prompts once on a 401)
await NEPGAdmin.push("data/x.json", json, { message: "Add entry" });
```
`requireAuth` rejects with `err.detail === "cancelled"` if the user closes the panel. Options: `force` (always prompt), `verify` (test stored token first).

## API
| Call | Purpose |
|---|---|
| `init(config)` | Set app defaults once; later calls inherit them |
| `open(opts?)` | Show the admin panel |
| `requireAuth(opts?)` | Promise of settings; prompts if no token |
| `push(path, content, {message, admin})` | Sign in + write file |
| `getSettings()` / `clearToken()` | Read resolved settings / wipe token |
| `client(opts?)` | GitHub client bound to current settings |
| `github.test / readFile / writeFile / deleteFile / listDir (settings, ...)` | Raw layer. Content may be string, Uint8Array, ArrayBuffer, Blob/File (images work). `readFile` returns `{sha,size,bytes,text}` or `null` if missing. |

Errors are `NEPGError` with `.status` (0 network, 401 bad token, 403 permission/rate limit, 404, 409/422 conflict) and friendly `.message`.

## Credentials
- **Default (`github.storage: "package"`)**: token saved in this browser under `nepg-admin:v1:<app>`. "Remember" = localStorage, otherwise sessionStorage.
- **App-owned (`storage: "app"`)**: the package never persists anything. Supply `token` or `getToken()` and handle `onTokenChange(token, settings)`. Use this to migrate an app without moving its existing token storage.
- All GitHub Pages sites under one account share an origin, so any app's JS can read any other app's localStorage. Keep fine-grained tokens scoped to one repo, Contents read/write only, with an expiry.

## Overrides
`backup.githubBackup(settings, client)`, `backup.githubRestore(settings, client)`, `backup.exportLocal()`, `backup.importLocal(file)`
replace the defaults when an app's data doesn't fit the simple model. `serviceWorker.refreshFromServer()` replaces the default
(unregister all service workers, delete all caches, reload). Callbacks `github.onTokenChange` and `onSettingsChange` fire on save/clear.
