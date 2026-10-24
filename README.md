# Videoxx

Desktop editor for explainer videos (pixel art, Vox editorial, your own styles), driven by your own Claude Code.
Electron 44 + electron-vite + React 19, plain JavaScript/JSX.

This source tree was reconstructed from the shipped 0.17.0 build (`Videoxx-src/out`), which was not minified.
Every original statement is kept; the code was split back into modules, `jsx()` calls were turned back into JSX
and the names rollup had suffixed (`cache$1`, `text2`) were restored where that was safe.

## Commands

```bash
npm install
npm run dev      # electron-vite dev with hot reload
npm run build    # out/main, out/preload, out/renderer
npm run pack     # build + unpacked app in dist/win-unpacked
npm run dist     # build + NSIS installer in dist/
```

Running against a throw-away profile (keeps your real settings, database and Documents/Videoxx untouched;
`CZ_NO_AUTO_SETUP=1` stops the first start from having Claude install a speech model):

```bash
CZ_USERDATA=/tmp/vx-ud CZ_WORKSPACE=/tmp/vx-ws CZ_NO_AUTO_SETUP=1 npx electron .
```

## Layout

| Path | What |
| --- | --- |
| `src/main/` | Electron main process, one folder per area (`core`, `db`, `engines`, `agent`, `projects`, `styles`, `studio`, `library`, `characters`, `images`, `audio`, `voice`, `pipeline`, `render`, `personal`, `channels`, `routines`, `ipc`, `app`). Entry: `src/main/index.js` |
| `src/main/addons/` | `videoxx-*.js` modules and `connector-templates/`, loaded with `require("./videoxx-…")` at runtime and copied next to `out/main/index.js` at build time |
| `src/preload/index.js` | `window.suite` bridge (allow-listed IPC channels) |
| `src/renderer/` | React UI. Entry `src/renderer/src/main.jsx`, root component `App.jsx`, styles `styles.css`; `public/videoxx-*-ui.js` are plain scripts loaded by `index.html` |
| `templates/` | Engines, skills and library shipped as `resources/templates` |
| `resources/` | Icons, shipped as `resources/resources` |
| `pipeline-scripts/` | Python helpers packed into the app |
| `tools/rebuild/` | The scripts and module map used to rebuild this tree from the bundle |

## Notes from the reconstruction

- The shipped `out/` had been edited after it was built (updates switched off with
  `const why = "Automatic updates are turned off in this build."`, some test hooks removed). Code that only those
  edits made unreachable is still in the source; rollup now drops it from the bundle.
- Comparing the rebuilt bundles with the shipped ones (`tools/rebuild/compare.mjs`) shows the same declarations and the same
  top-level side effects. Apart from code that never runs and renamed identifiers, the only difference is the order of two
  independent callback registrations in main (`setSharedCheck` and `setPublishInfo`).
- Icons come from `lucide-react`, pinned to 1.57.0: its icon data matches the copy that was bundled in the build
  (1.58 and later redraw `music`, `music-2` and `brain`).
- The original was TypeScript (CSS comments still mention `components/ui.tsx`); types could not be recovered.
