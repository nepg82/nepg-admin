# NEPG Admin — Integration Guide

Rules for every migration thread. Keep this file updated with each app's migration notes.

## Conventions
1. Every app loads the shared script once and calls `NEPGAdmin.init({...})` at startup.
2. One admin entry point per app, calling `NEPGAdmin.open()`. Apps that previously showed admin only on a failed push use `NEPGAdmin.requireAuth()` / `NEPGAdmin.push()` instead and keep that behavior.
3. Token storage is the package's (`storage: "package"`). Use `"app"` only as a temporary bridge.
4. Data goes through `data: {path, get, apply}`. Don't change the repo file's JSON shape.
5. Delete the app's old GitHub fetch/PUT code once the package covers it. No duplicate SHA logic.
6. Add `nepg-admin.js`, `.css`, and the font to the app's service worker cache; bump the cache version.
7. Remove the old token from localStorage after migration, or have the user re-enter it once.

## Checklist per app
- [ ] List where the current token is stored and its key name
- [ ] List every GitHub read/write call and its repo path
- [ ] Identify the admin trigger (button, gesture, or on-failed-push)
- [ ] Map each data file to `get`/`apply`
- [ ] Wire `init`, trigger, and replace write calls
- [ ] Test: no token, bad token, offline, good token, restore, local export/import
- [ ] Service worker cache updated; hard-refresh test on phone
- [ ] Write migration notes below

## Special cases
- **Biker Church**: images are binary writes (`writeFile` accepts Blob/File); posts are likely several files, so use the `data` array or `client()` directly.
- **FitMac**: two users probably means two data files.
- **OurMovies**: TMDB key is not a GitHub credential. Leave it out of NEPG Admin.

## Starter prompt for a new thread
> I'm integrating the NEPG universal admin package into an existing PWA. Attached: the package files (nepg-admin.js, .css, README, INTEGRATION_GUIDE) and the relevant files from the target app (<app>). Read the README and guide first, then explain how this app currently handles GitHub credentials, pushes, and its admin UI. Propose a migration plan and wait for my OK before writing code. Preserve existing behavior and the repo data format. At the end, give me migration notes for the guide.

## Migration notes
(none yet)
