# audiobookshelf

MCP connector for a self-hosted [Audiobookshelf](https://github.com/advplyr/audiobookshelf) server. It speaks the HTTP API over stdio and over stateless Streamable HTTP on `127.0.0.1`.

Audiobookshelf is GPL-3.0 software. This connector does not copy that code. It only calls the HTTP API on the server you configure. It is not affiliated with Audiobookshelf. Bring your own API token from your user (Settings → API Keys, or an account token). The connector sends `Authorization: Bearer <token>`.

The operations table is generated from `vendor/ApiRouter.js` (copied from Audiobookshelf `server/routers/ApiRouter.js`). The router has 202 string routes. This connector covers 181 of them in 26 tools. It leaves out 21 endpoints that stream media, download archives, upload files, or open playback sessions. `scripts/gen-operations.mjs` writes `src/operations.ts`. Do not edit that file by hand.

Self-hosted servers only. There is no default base URL. `ABS_BASE_URL` is required. There is no hosted Audiobookshelf cloud to call.

## Setup

```bash
npm install
npm run ci
npm start
npm run start:http
```

`npm start` speaks stdio. `npm run start:http` serves Streamable HTTP at `http://127.0.0.1:3000/mcp` and `GET /health`. HTTP mode has no authentication of its own. Keep it on localhost.

```json
{
  "mcpServers": {
    "audiobookshelf": {
      "command": "node",
      "args": ["/workspace/connectors/audiobookshelf/dist/index.js"],
      "env": {
        "ABS_BASE_URL": "http://127.0.0.1:13378",
        "ABS_API_TOKEN": "...",
        "ABS_ALLOW_WRITES": "false",
        "ABS_TOOLSETS": "libraries,items,collections,playlists,me,authors,series,podcasts,search,sessions,stats,tags,genres"
      }
    }
  }
}
```

Docker (HTTP, no authentication — keep it on localhost):

```bash
docker build -t audiobookshelf .
docker run -p 127.0.0.1:3000:3000 \
  -e ABS_BASE_URL=http://127.0.0.1:13378 \
  -e ABS_API_TOKEN=... \
  audiobookshelf
```

Do not put tokens in the image.

Regenerate the registry after an ApiRouter bump.

```bash
npm run gen:operations
```

`scripts/live-check.mjs` talks to a real server over stdio. It needs `ABS_BASE_URL` and `ABS_API_TOKEN`, sets `ABS_TOOLSETS=all` and `ABS_ALLOW_WRITES=true`, and prints pass or fail lines only. This workspace does not start Audiobookshelf.

## Config

| Variable            | Meaning                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ABS_BASE_URL`      | Required. Self-hosted origin, `http` or `https`, no userinfo, query, hash, or path. Example `http://127.0.0.1:13378`.                                    |
| `ABS_API_TOKEN`     | Bearer token from your Audiobookshelf user. Sent as `Authorization: Bearer <token>`. Never placed in the URL. Redacted in logs, errors, and tool output. |
| `ABS_ALLOW_WRITES`  | Must be the literal `true` before a confirmed write is sent.                                                                                             |
| `ABS_TOOLSETS`      | Comma list of toolsets, or `all`. Default is the read-focused set below. `admin` and `users` are off by default.                                         |
| `ABS_PER_MINUTE`    | Local request budget. Default 30. Cache hits do not spend it.                                                                                            |
| `ABS_TIMEOUT_MS`    | Upstream timeout. Default 20000.                                                                                                                         |
| `ABS_CACHE_TTL_SEC` | Read cache TTL. Default 60. Writes clear the cache.                                                                                                      |
| `ABS_CONTACT`       | Contact token in the User-Agent. Must not contain the token.                                                                                             |
| `MCP_TRANSPORT`     | `stdio` or `http`. `--http` overrides.                                                                                                                   |
| `PORT`              | HTTP port. Default 3000. Bound to `127.0.0.1`.                                                                                                           |

Invalid values are reported by field name and issue code. The rejected value is not included. The token is redacted in logs, errors, tool results, thrown messages, and URLs.

## Safety

GET is a read. POST, PUT, PATCH, and DELETE are writes, except a reviewed list of POST queries in `READ_POST_PATHS` (batch item get, podcast feed lookup, OPML parse, filesystem path exists, cron validate, authorize). A few GETs that match, check, restore, or test are writes (`GET_SIDE_EFFECT_PATHS`). Anything not on the read list stays a write.

A write needs `confirm: true` as a boolean and `ABS_ALLOW_WRITES=true`. The string `"true"` is rejected. Otherwise the tool returns a dry-run preview of method, path, query, and redacted body, and it sends nothing. Destructive and credential operations add a warning line on the tool and on the preview. That set covers deletes, scans, match-all, backup restore, user changes, API key create and revoke, password, and settings.

API key create returns the key once, with a shown-only-once note. Later list and get calls redact it. User `apiKey`, `email`, `token`, and `password` are redacted. Library folder paths stay in successful responses. Error text drops stack traces and filesystem paths.

HTTP 401 is unauthorized. HTTP 403 is forbidden. HTTP 404 is not found. HTTP 400 and 422 are invalid input. HTTP 429 includes Retry-After. Other failures are server, network, or timeout. Response bodies are capped.

Sessions are read and close only. The connector does not start playback, sync open sessions, or bulk-delete session records.

## Tools

Default `ABS_TOOLSETS` publishes 13 tools (123 operations). `ABS_TOOLSETS=all` publishes 26 tools (181 operations, 74 reads and 107 writes). Each tool takes `action` plus optional `params`, `query`, `body`, and `confirm`.

`action` `help` with optional `target` returns the path, query, and body fields for one action. Descriptions list action names only, so the tool list stays small.

| Toolset            | Tool                     | Operations | Default |
| ------------------ | ------------------------ | ---------- | ------- |
| libraries          | `abs_libraries`          | 26         | yes     |
| items              | `abs_items`              | 18         | yes     |
| collections        | `abs_collections`        | 9          | yes     |
| playlists          | `abs_playlists`          | 10         | yes     |
| me                 | `abs_me`                 | 23         | yes     |
| authors            | `abs_authors`            | 5          | yes     |
| series             | `abs_series`             | 2          | yes     |
| podcasts           | `abs_podcasts`           | 12         | yes     |
| search             | `abs_search`             | 6          | yes     |
| sessions           | `abs_sessions`           | 4          | yes     |
| stats              | `abs_stats`              | 2          | yes     |
| tags               | `abs_tags`               | 3          | yes     |
| genres             | `abs_genres`             | 3          | yes     |
| admin              | `abs_admin`              | 8          | no      |
| users              | `abs_users`              | 9          | no      |
| backups            | `abs_backups`            | 5          | no      |
| filesystem         | `abs_filesystem`         | 2          | no      |
| notifications      | `abs_notifications`      | 8          | no      |
| emails             | `abs_emails`             | 5          | no      |
| cache              | `abs_cache`              | 2          | no      |
| tools              | `abs_tools`              | 4          | no      |
| feeds              | `abs_feeds`              | 5          | no      |
| metadata_providers | `abs_metadata_providers` | 3          | no      |
| share              | `abs_share`              | 2          | no      |
| api_keys           | `abs_api_keys`           | 4          | no      |
| tasks              | `abs_tasks`              | 1          | no      |

Example. List libraries, then preview a scan.

```json
{ "action": "get" }
```

```json
{ "action": "post_scan", "params": { "id": "lib_..." } }
```

Add `"confirm": true` only after `ABS_ALLOW_WRITES=true`.

## Exclusions

21 operations are in `EXCLUSIONS`, each with a reason. The coverage test checks that the router equals the registry plus that list, in both directions.

- Audio and ebook file streams, cover and author images, ebook bytes.
- Item, library, and backup zip downloads. An MCP text tool cannot carry the archive.
- OPML file download.
- Multipart uploads (library item, cover, author image, backup). The tool sends JSON and cannot attach a file part.
- Playback session start (`/api/items/:id/play` and episode play). Sessions are read and close only.
- Open-session progress sync and local session push.
- Bulk session delete. Close is one id only (`POST /api/session/:id/close`).
- Bulk podcast episode media download onto the server.

JSON catalogue, progress, playlist, collection, and admin JSON stay in the registry.

## Comparison with michaeldvinci/audiobookshelf-mcp

The Go connector at [michaeldvinci/audiobookshelf-mcp](https://github.com/michaeldvinci/audiobookshelf-mcp) exposes these tools (from its README and `src`):

`libraries`, `library`, `create_library`, `item`, `author`, `collections`, `collection`, `create_collection`, `add_to_collection`, `playlists`, `playlist`, `create_playlist`, `add_to_playlist`, `me`, `sessions`, `session`, `podcasts`, `podcast`, `check_podcast_episodes`, `update_progress`, `create_backup`.

That is a fixed list of 21 tools covering libraries, one item, authors, collections, playlists, me/progress, sessions, podcasts, and backup create. It uses `ABS_API_KEY`.

This connector covers those areas and more: series, tags, genres, stats, search, users, admin settings, notifications, emails, cache, tools, feeds, metadata providers, share, API keys, tasks, filesystem, logs-adjacent admin JSON, and session close. Writes are dry-run unless `confirm: true` and `ABS_ALLOW_WRITES=true`. Responses are parsed with Zod. The token is a Bearer `ABS_API_TOKEN` and is redacted in every log and error. Admin and users stay off until you opt in.

## What this is not

This is not a hosted Audiobookshelf client. There is no default cloud origin. It does not stream audio, download archives, upload files, or start playback. It does not copy Audiobookshelf source. HTTP mode is an unauthenticated localhost transport for your own process.

Live check has not been run yet. See `LIVE-CHECK.md`.

## Regenerating the operations table

`src/operations.ts` is generated from upstream `server/routers/ApiRouter.js` (GPL-3.0, not vendored here). To regenerate, download that file from github.com/advplyr/audiobookshelf into `vendor/ApiRouter.js` and run `npm run gen:operations`.

## License

MIT for this connector. Audiobookshelf itself is GPL-3.0 and is not affiliated with this project.
