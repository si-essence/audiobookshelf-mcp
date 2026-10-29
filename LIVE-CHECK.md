# Live check against a self-hosted Audiobookshelf

**Result: PASS, passed=25 failed=0** (2026-10-29, ~09:50 Accra, GMT).

Server: Audiobookshelf 2.37.2 built from source (github.com/advplyr/audiobookshelf, `npm ci --omit=dev`, no web client build, no Docker), run with `node index.js` on 127.0.0.1:13378, `DATABASE_URL` unset, throwaway `/tmp` config/metadata dirs. Throwaway root user created via `/init`; token from `/login` (never printed). One throwaway library with a single 2-second silent mp3 made with ffmpeg. Server and data torn down afterwards.

Command: `ABS_BASE_URL=http://127.0.0.1:13378 ABS_API_TOKEN=... ABS_ALLOW_WRITES=true npm run live-check`

Checks (25): tool listing; libraries; me (plus token fields redacted); collections; playlists; sessions; open sessions; tags; genres; stats; search providers; users; tasks; backups; unknown item id (clean error, no secret leak); library items; library search; collection preview + create + delete; playlist preview + create + delete; library delete preview only (not executed).

Scope honesty: about 20 of 181 covered operations ran live. Everything else (podcasts, authors/series edits, progress writes, admin settings, notifications, emails, api keys, feeds, share, filesystem, metadata providers, backups writes) is covered by mock tests only.

One fix during the run: Audiobookshelf rejects a collection with no books (400 "No books"), so the script now adds the first library item to the throwaway collection.
