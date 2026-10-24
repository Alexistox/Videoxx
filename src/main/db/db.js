import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

let db;
export const uid = (p = "") => p + crypto.randomBytes(6).toString("hex");
export const now = () => new Date().toISOString();
const MIGRATIONS = [
  `CREATE TABLE projects (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
     preset_id TEXT, status TEXT NOT NULL DEFAULT 'draft', duration REAL DEFAULT 0, shots INTEGER DEFAULT 0,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL, opened_at TEXT);
   CREATE TABLE threads (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     title TEXT NOT NULL, claude_session_id TEXT, kind TEXT NOT NULL DEFAULT 'edit',
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
     role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE INDEX messages_thread ON messages(thread_id, id);
   CREATE TABLE edits (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, thread_id TEXT,
     instruction TEXT NOT NULL, scope TEXT, selection TEXT, status TEXT NOT NULL,
     commit_before TEXT, commit_after TEXT, files TEXT, summary TEXT, cost_usd REAL DEFAULT 0, duration_ms INTEGER DEFAULT 0,
     created_at TEXT NOT NULL, finished_at TEXT);
   CREATE INDEX edits_project ON edits(project_id, created_at);
   CREATE TABLE presets (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, settings TEXT NOT NULL, builtin INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE rules (
     id TEXT PRIMARY KEY, scope TEXT NOT NULL, project_id TEXT, text TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
     status TEXT NOT NULL DEFAULT 'active', source_edit_id TEXT, created_at TEXT NOT NULL);
   CREATE TABLE renders (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, kind TEXT NOT NULL,
     path TEXT, status TEXT NOT NULL, progress REAL DEFAULT 0, message TEXT, seconds REAL, created_at TEXT NOT NULL, finished_at TEXT);
   CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT);`,
  // v2: token accounting per edit
  `ALTER TABLE edits ADD COLUMN tokens_in INTEGER DEFAULT 0; ALTER TABLE edits ADD COLUMN tokens_out INTEGER DEFAULT 0;`,
  // v3: where an imported project came from (re-importing the same folder opens the existing copy)
  `ALTER TABLE projects ADD COLUMN source TEXT;`,
  // v4: styles - every look (preset) and project belongs to one (pixel art is the first)
  `ALTER TABLE presets ADD COLUMN style_id TEXT NOT NULL DEFAULT 'pixel-art'; ALTER TABLE projects ADD COLUMN style_id TEXT NOT NULL DEFAULT 'pixel-art';`,
  // v5: two workspaces (Faceless Brand / Personal Brand); personal videos are laid out from layout presets
  `ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'faceless';
   CREATE TABLE layouts (id TEXT PRIMARY KEY, name TEXT NOT NULL, settings TEXT NOT NULL, builtin INTEGER NOT NULL DEFAULT 0,
     is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`,
  // v6: Studio > Thumbnails: canvas boards and their Higgsfield generations
  `CREATE TABLE boards (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE generations (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, node_id TEXT NOT NULL, model TEXT NOT NULL, prompt TEXT NOT NULL,
     params TEXT NOT NULL, refs TEXT NOT NULL, status TEXT NOT NULL, request_id TEXT, file TEXT, error TEXT, created_at TEXT NOT NULL, finished_at TEXT);
   CREATE INDEX generations_board ON generations(board_id);`,
  // v7: a board can belong to a Personal video (its own board), and one board is pinned as the Master board
  `ALTER TABLE boards ADD COLUMN project_id TEXT;
   ALTER TABLE boards ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;`,
  // v8: boards belong to one workspace (each has its own Master and list); existing boards were made in Personal,
  // a project's board follows its project
  `ALTER TABLE boards ADD COLUMN brand TEXT NOT NULL DEFAULT 'personal';
   UPDATE boards SET brand = COALESCE((SELECT kind FROM projects WHERE projects.id = boards.project_id), 'personal') WHERE project_id IS NOT NULL;
   CREATE INDEX boards_brand ON boards(brand);`,
  // v9: channels (brandless: one YouTube channel can hold Faceless and Personal videos) and the production pipeline.
  // A project's stage is NULL while it is automatic (from its files); a dragged stage remembers the automatic one at
  // that moment (stage_auto) so it can step back once the project moves past it. Ideas are cards that are not projects yet.
  // yt_channel_id / settings leave room for the YouTube link. None of this is mirrored into project.json (git reverts).
  `CREATE TABLE channels (id TEXT PRIMARY KEY, name TEXT NOT NULL, handle TEXT, color TEXT NOT NULL DEFAULT '#89bea4', avatar TEXT, description TEXT,
     yt_channel_id TEXT UNIQUE, sort REAL NOT NULL DEFAULT 0, settings TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   ALTER TABLE projects ADD COLUMN channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL;
   ALTER TABLE projects ADD COLUMN stage TEXT;
   ALTER TABLE projects ADD COLUMN stage_auto TEXT;
   ALTER TABLE projects ADD COLUMN stage_at TEXT;
   ALTER TABLE projects ADD COLUMN stage_order REAL;
   ALTER TABLE projects ADD COLUMN due_at TEXT;
   ALTER TABLE projects ADD COLUMN plan_note TEXT;
   CREATE INDEX projects_channel ON projects(channel_id);
   CREATE TABLE ideas (id TEXT PRIMARY KEY, channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL, title TEXT NOT NULL, notes TEXT,
     stage TEXT NOT NULL DEFAULT 'idea', sort REAL NOT NULL DEFAULT 0, due_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX ideas_channel ON ideas(channel_id);`,
  // v10: YouTube (youtube/). A YouTube channel the app follows (public stats with an API key, or full analytics signed in
  // with Google; tokens live in secrets.ts, never here), its videos (a video can be linked to the project it came from),
  // daily analytics, daily public totals, recent comments, and the "what's working" insights of a Videoxx channel.
  // A video YouTube no longer lists is kept as gone (its project link survives a video turned private for a while).
  `CREATE TABLE yt_channels (id TEXT PRIMARY KEY, title TEXT NOT NULL, handle TEXT, description TEXT, avatar TEXT, avatar_url TEXT, uploads TEXT, created TEXT,
     subs INTEGER, views INTEGER, videos INTEGER, hidden_subs INTEGER NOT NULL DEFAULT 0, access TEXT NOT NULL DEFAULT 'public', analytics INTEGER NOT NULL DEFAULT 0,
     sort REAL NOT NULL DEFAULT 0, added_at TEXT NOT NULL, fetched_at TEXT, analytics_at TEXT, error TEXT);
   CREATE TABLE yt_videos (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES yt_channels(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT,
     published_at TEXT, publish_at TEXT, privacy TEXT, duration REAL, thumb_url TEXT, thumb TEXT, views INTEGER, likes INTEGER, comments INTEGER,
     minutes REAL, avg_duration REAL, avg_pct REAL, subs_gained INTEGER, retention TEXT, traffic TEXT, detail_at TEXT, gone INTEGER NOT NULL DEFAULT 0,
     project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, linked_at TEXT, fetched_at TEXT);
   CREATE INDEX yt_videos_channel ON yt_videos(channel_id, published_at);
   CREATE UNIQUE INDEX yt_videos_project ON yt_videos(project_id) WHERE project_id IS NOT NULL;
   CREATE TABLE yt_daily (channel_id TEXT NOT NULL REFERENCES yt_channels(id) ON DELETE CASCADE, day TEXT NOT NULL, views INTEGER, minutes REAL, avg_duration REAL,
     avg_pct REAL, subs_gained INTEGER, subs_lost INTEGER, likes INTEGER, comments INTEGER, PRIMARY KEY(channel_id, day));
   CREATE TABLE yt_snapshots (channel_id TEXT NOT NULL REFERENCES yt_channels(id) ON DELETE CASCADE, day TEXT NOT NULL, subs INTEGER, views INTEGER, videos INTEGER,
     PRIMARY KEY(channel_id, day));
   CREATE TABLE yt_comments (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES yt_channels(id) ON DELETE CASCADE, video_id TEXT, author TEXT, text TEXT,
     likes INTEGER, replies INTEGER, published_at TEXT, fetched_at TEXT);
   CREATE INDEX yt_comments_channel ON yt_comments(channel_id, published_at);
   CREATE INDEX yt_comments_video ON yt_comments(video_id, published_at);
   CREATE TABLE yt_insights (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, kind TEXT NOT NULL, text TEXT NOT NULL, why TEXT,
     status TEXT NOT NULL DEFAULT 'suggested', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX yt_insights_channel ON yt_insights(channel_id, status);`,
  // When each video was uploaded (YouTube's snippet.publishedAt, kept for every video): a private one has no publish date,
  // and was dated by when it was read (so it sorted as the newest). Filled by the next read.
  `ALTER TABLE yt_videos ADD COLUMN uploaded_at TEXT;`,
  // Routines (routines/). A routine is a node graph; a run keeps its own copy of the graph and settings (editing the
  // routine meanwhile changes nothing in it); an item is one video going through it, with what each node made (context)
  // and how each node went (nodes), saved after every node so a run cut off by a quit can resume.
  `CREATE TABLE routines (id TEXT PRIMARY KEY, name TEXT NOT NULL, graph TEXT NOT NULL, settings TEXT NOT NULL DEFAULT '{}', sched_at TEXT,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_run_at TEXT);
   CREATE TABLE routine_runs (id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE, status TEXT NOT NULL, trigger TEXT NOT NULL,
     graph TEXT NOT NULL, settings TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, summary TEXT);
   CREATE INDEX routine_runs_routine ON routine_runs(routine_id, started_at);
   CREATE TABLE routine_items (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES routine_runs(id) ON DELETE CASCADE, idx INTEGER NOT NULL, label TEXT, source TEXT,
     status TEXT NOT NULL, project_id TEXT, context TEXT NOT NULL DEFAULT '{}', nodes TEXT NOT NULL DEFAULT '{}', error TEXT, started_at TEXT, finished_at TEXT);
   CREATE INDEX routine_items_run ON routine_items(run_id, idx);`,
  // Claude usage per turn of every run (sessions.ts): how much of each request was read from the prompt cache (cheap) and
  // how much was written to it (a cold or broken cache bills the whole conversation again), how many images came back
  // from tools, and turns after a result (background wake-ups). threads.context_tokens: the conversation's size after its
  // last run (a long one starts fresh with a summary instead of being re-read on every request).
  `CREATE TABLE claude_turns (edit_id TEXT NOT NULL REFERENCES edits(id) ON DELETE CASCADE, n INTEGER NOT NULL, at TEXT NOT NULL, model TEXT,
     agent INTEGER NOT NULL DEFAULT 0, wake INTEGER NOT NULL DEFAULT 0, input INTEGER NOT NULL DEFAULT 0, cache_read INTEGER NOT NULL DEFAULT 0,
     cache_write INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, images INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX claude_turns_edit ON claude_turns(edit_id, n);
   ALTER TABLE edits ADD COLUMN cache_read INTEGER DEFAULT 0; ALTER TABLE edits ADD COLUMN cache_write INTEGER DEFAULT 0;
   ALTER TABLE threads ADD COLUMN context_tokens INTEGER DEFAULT 0;`,
  // Claude's model and effort for one project (its Claude panel): NULL = the global setting (Settings > AI engines). Kept in the
  // database, not project.json, so reverting an edit never changes the model the project runs on.
  `ALTER TABLE projects ADD COLUMN claude_model TEXT; ALTER TABLE projects ADD COLUMN claude_effort TEXT;`,
  // a project's own picture service, voice, music and sound effects (its Project settings, shared/overrides.ts): JSON,
  // NULL or a missing key = the global setting. In the database for the same reason as the model above.
  `ALTER TABLE projects ADD COLUMN overrides TEXT;`,
  // what a Claude run spent its steps on (sessions.ts recordUsage): per tool name the calls, the images it handed back and
  // their estimated tokens, frames answered from the cache and calls over the run's image budget. JSON.
  `ALTER TABLE edits ADD COLUMN tool_usage TEXT;`,
  // the Claude Code session a run worked in (the Claude panel's context meter: what one conversation used across its runs;
  // a fresh conversation in the same thread starts its own count). NULL for runs before this.
  `ALTER TABLE edits ADD COLUMN session_id TEXT;`,
  // a video's format: 'long' or 'short' (the channel tab it was read from without a key; with the API from its length,
  // up to 3 min = short), NULL = not known. ago: the channel page's "2 years ago" (keyless reads have no exact date).
  `ALTER TABLE yt_videos ADD COLUMN format TEXT; ALTER TABLE yt_videos ADD COLUMN ago TEXT;`,
  // where a look row came from: NULL = the app's built-in looks, the user's own looks and old lab styles (as before);
  // 'package' = seeded from a style package (stylePackages.ts); 'studio' = a look made in the Style Studio
  `ALTER TABLE presets ADD COLUMN origin TEXT;`,
  // what kind of lab a project is: NULL = a video (or an old style / character lab, still told apart by its project.json);
  // 'studio' = a Style Studio workspace (studio/workspace.ts). Kept in the database: Claude can't make a project one.
  `ALTER TABLE projects ADD COLUMN lab_kind TEXT;`,
  // the Library (library/, docs/LIBRARY_PLAN.md): a rebuildable index of its entries (files are the truth: templates/library,
  // <workspace>/library and the libraries indexed in place), links between entries, every hit / get / use / outcome per
  // project (the ranking and the flags come from these), and the entries a run used. The full-text table (lib_fts) is made
  // by openLibrary(), not here: a build without FTS5 must still start (it falls back to LIKE).
  `CREATE TABLE lib_entries (id TEXT PRIMARY KEY, uid TEXT, kind TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
     tags TEXT NOT NULL DEFAULT '', bases TEXT NOT NULL DEFAULT '', engines TEXT, engine_min INTEGER, engine_max INTEGER, scope TEXT NOT NULL DEFAULT 'global',
     status TEXT NOT NULL DEFAULT 'accepted', version INTEGER NOT NULL DEFAULT 1, hash TEXT, code_hash TEXT, dir TEXT, preview TEXT, licence TEXT, bytes INTEGER NOT NULL DEFAULT 0,
     delivery TEXT NOT NULL DEFAULT 'copy', body TEXT NOT NULL DEFAULT '', created TEXT, updated TEXT, indexed_at TEXT NOT NULL);
   CREATE INDEX lib_entries_kind ON lib_entries(kind, status);
   CREATE INDEX lib_entries_source ON lib_entries(source);
   CREATE TABLE lib_links (a TEXT NOT NULL, b TEXT NOT NULL, rel TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(a, b, rel));
   CREATE INDEX lib_links_b ON lib_links(b);
   CREATE TABLE lib_uses (n INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL, version INTEGER, project_id TEXT, edit_id TEXT, kind TEXT NOT NULL,
     outcome TEXT, note TEXT, at TEXT NOT NULL);
   CREATE INDEX lib_uses_entry ON lib_uses(entry_id, kind, n);
   CREATE INDEX lib_uses_project ON lib_uses(project_id, n);
   ALTER TABLE edits ADD COLUMN lib_used TEXT;`,
  // what kind of Claude run an edit row is (sessions.ts TaskKind: edit, build, ultra, harvest...); NULL for runs before this.
  // The Library's harvest runs are told apart by it (never the project's conversation, the Usage page counts them).
  `ALTER TABLE edits ADD COLUMN kind TEXT;`,
  // which engine ran a conversation / a run (shared/engines.ts: 'claude', 'google' = Settings > Experimental's Google
  // models through CLIProxyAPI, 'codex' later). NULL = Claude (every run before this). threads.claude_session_id holds
  // that engine's session or thread id; a project that switches engine starts a fresh conversation (sessions.ts).
  `ALTER TABLE threads ADD COLUMN engine TEXT; ALTER TABLE edits ADD COLUMN engine TEXT;`,
];
export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
  const v = db.prepare("PRAGMA user_version").get().user_version;
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return db;
}
export function recoverInterrupted() {
  const r = q.run(
    "UPDATE renders SET status='failed', message='Interrupted: the app closed during the export.', finished_at=? WHERE status='running'",
    now(),
  );
  return Number(r.changes);
}
export function dailyBackup(workspace) {
  const dir = path.join(workspace, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `suite-${new Date().toISOString().slice(0, 10)}.db`);
  if (fs.existsSync(f)) return null;
  db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  const old = fs
    .readdirSync(dir)
    .filter((x) => /^suite-\d{4}-\d{2}-\d{2}\.db$/.test(x))
    .sort()
    .slice(0, -7);
  old.forEach((x) => fs.rmSync(path.join(dir, x), { force: true }));
  return f;
}
export function closeDb() {
  try {
    db?.close();
  } catch {}
}
export const q = {
  all: (sql, ...a) => db.prepare(sql).all(...a),
  get: (sql, ...a) => db.prepare(sql).get(...a),
  run: (sql, ...a) => db.prepare(sql).run(...a),
};
export function tx(f) {
  db.exec("BEGIN");
  try {
    const r = f();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw e;
  }
}
export const execSql = (sql) => db.exec(sql);
export function dbHealth() {
  const ok = q.get("PRAGMA integrity_check")?.integrity_check === "ok";
  const counts = Object.fromEntries(
    ["projects", "threads", "messages", "edits", "presets", "rules", "renders", "channels", "ideas", "yt_channels", "yt_videos"].map(
      (t) => [t, q.get(`SELECT COUNT(*) n FROM ${t}`).n],
    ),
  );
  const version = q.get("PRAGMA user_version").user_version;
  return { ok, version, counts };
}
