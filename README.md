# NEPG Admin

Canonical administration panel for NEPG's GitHub Pages PWAs.

## Files

- `nepg-admin.js` — self-contained admin panel.
- `nepg-admin.css` — canonical Mac OS-style UI.

## Integration

Load the CSS and JS from the canonical deployment, then call:

```js
NEPGAdmin.open({
  appName: "GarageLog",
  github: {
    owner: "nepg82",
    repo: "garagelog",
    branch: "main",
    token: getTokenFromThisApp(),
    rememberToken: true,
    onTokenChange: saveTokenInThisApp
  },
  backup: {
    githubBackup: function (settings) {
      // App-specific GitHub backup implementation.
    },
    githubRestore: function (settings) {
      // App-specific GitHub restore implementation.
    },
    exportLocal: function () {
      // App-specific JSON export.
    },
    importLocal: function (file) {
      // App-specific JSON import.
    }
  },
  serviceWorker: {
    refreshFromServer: function () {
      // App-specific cache/service-worker refresh.
    }
  }
});
```

### Credential boundary

NEPG Admin does **not** persist GitHub PATs. Each PWA owns its own token storage and supplies its token at runtime. This keeps credentials out of the canonical repository.

### Important

The current package establishes the UI and integration boundary. GitHub backup/restore and service-worker refresh remain callbacks because each PWA's data format, GitHub file layout, and service-worker implementation are app-specific.
