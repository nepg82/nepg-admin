# NEPG Admin — Integration Guide

Rules for every migration thread. Keep this file updated with each app's migration notes.

## Conventions
1. Every app loads the shared script once and calls `NEPGAdmin.init({...})` at startup.
2. One admin entry point per app, calling `NEPGAdmin.open()`. Apps that previously showed admin only on a failed push use `NEPGAdmin.requireAuth()` / `NEPGAdmin.push()` instead and keep that behavior.
3. Token storage is the package's (`storage: "package"`). Use `"app"` only as a temporary bridge.
4. Data goes through `data: {path, get, apply}`. Don't change the repo file's JSON shape.
5. Delete the app's old GitHub fetch/PUT code once the package covers it. No duplicate SHA logic.
6. Add the shared-admin block from "Service worker" below to the app's `sw.js`. Do NOT list the admin files in the app's own versioned cache.
7. Remove the old token from localStorage after migration, or have the user re-enter it once.

## Service worker (required in every app)

The admin repo lives at its own path, but the app's service worker still sees those requests (scope limits which *pages* it controls, not which URLs they fetch). The block below gives the admin files their own cache that updates itself, so a fix in the admin repo reaches every app with no per-app cache bump.

Paste into each app's `sw.js`, **above** the app's own `fetch` listener (the first listener to call `respondWith` wins):

```js
// ---- NEPG Admin shared files (identical in every app) ----
const NEPG_BASE  = "https://nepg82.github.io/nepg-admin/";   // adjust to the real admin repo URL
const NEPG_CACHE = "nepg-admin-shared";                      // deliberately NOT versioned
const NEPG_FILES = ["nepg-admin.js", "nepg-admin.css", "fonts/ChiKareGo2.ttf"].map(f => NEPG_BASE + f);

self.addEventListener("install", (e) => e.waitUntil(
  caches.open(NEPG_CACHE).then(c => Promise.all(NEPG_FILES.map(u =>
    fetch(u, { cache: "reload" }).then(r => r.ok && c.put(u, r)).catch(() => {})
  )))
));

self.addEventListener("fetch", (e) => {
  if (!e.request.url.startsWith(NEPG_BASE)) return;          // not ours: fall through to the app's handler
  e.respondWith(caches.open(NEPG_CACHE).then(async (c) => {
    const hit = await c.match(e.request);
    const net = fetch(e.request, { cache: "reload" })        // bypass the browser's 10-minute HTTP cache
      .then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })
      .catch(() => null);
    return hit || (await net) || Response.error();
  }));
});
// ---- end NEPG Admin ----
```

**Check the app's existing `activate` handler.** Most service workers delete every cache whose name isn't the current version. That would wipe `nepg-admin-shared` on every update. Exclude it, e.g. `if (k !== CACHE && k !== "nepg-admin-shared") caches.delete(k)`.

Behavior to expect:
- Admin files are served from cache instantly (works offline), and refreshed in the background on each load. A new admin version appears on the *next* load after it is fetched.
- Editing `sw.js` makes the browser install the new worker, so each app picks this up the next time it's opened online. Test it with a phone hard-refresh.
- The panel's "Refresh From Server" button unregisters workers and clears all caches, including this one, so it is the manual escape hatch.
- If an app's own `sw.js` uses cache-first for everything and registers its `fetch` listener before this block, the admin files will never update. Order matters.

## Checklist per app
- [ ] List where the current token is stored and its key name
- [ ] List every GitHub read/write call and its repo path
- [ ] Identify the admin trigger (button, gesture, or on-failed-push)
- [ ] Map each data file to `get`/`apply`
- [ ] Wire `init`, trigger, and replace write calls
- [ ] Test: no token, bad token, offline, good token, restore, local export/import
- [ ] Shared-admin SW block added above the app's fetch handler; `activate` cleanup spares `nepg-admin-shared`
- [ ] Update test: change a visible string in the admin repo, reload the app twice, confirm it appears
- [ ] Write migration notes below

## Special cases
- **Biker Church**: images are binary writes (`writeFile` accepts Blob/File); posts are likely several files, so use the `data` array or `client()` directly.
- **FitMac**: two users probably means two data files.
- **OurMovies**: TMDB key is not a GitHub credential. Leave it out of NEPG Admin.

## Starter prompt for a new thread
> I'm integrating the NEPG universal admin package into an existing PWA. Attached: the package files (nepg-admin.js, .css, README, INTEGRATION_GUIDE) and the relevant files from the target app (<app>). Read the README and guide first, then explain how this app currently handles GitHub credentials, pushes, and its admin UI. Propose a migration plan and wait for my OK before writing code. Preserve existing behavior and the repo data format. At the end, give me migration notes for the guide.

## Migration notes
(none yet)