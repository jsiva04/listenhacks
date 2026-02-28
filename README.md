# StandupBot — Backboard.io Storage Layer

Persists daily standup transcripts and extracted structured data into [Backboard.io](https://backboard.io). This is the storage layer only — no Slack, no ElevenLabs.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and set BACKBOARD_API_KEY

# 3. Start the server
npm run dev
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `BACKBOARD_API_KEY` | ✅ | — | Your Backboard.io API key |
| `PORT` | — | `3000` | Server port |
| `THREAD_PER_DAY` | — | `false` | Thread strategy (see below) |

## Thread Strategy (`THREAD_PER_DAY`)

| Value | Key Format | Behavior |
|---|---|---|
| `false` (default) | `team_id:user_id` | One thread per user — all standups accumulate over time. Best for long-term memory. |
| `true` | `team_id:user_id:date` | New thread each day — clean separation per standup. Better for isolated daily snapshots. |

## Data Model

```
Assistant (one, shared by all team members)
│   system_prompt: "Track daily standup progress..."
│
├── Thread (per user or per user+date)
│   ├── [user]      "[standup] team=... user=... date=..."
│   │               "--- TRANSCRIPT ---"
│   │               <raw transcript>
│   │
│   ├── [assistant]  "[standup] team=... user=... date=..."
│   │               "--- EXTRACTED ---"
│   │               {"yesterday":"...","today":"...","blockers":"..."}
│   │
│   └── [assistant]  "[standup] team=... user=... date=..."  (optional)
│                   "--- SUMMARY ---"
│                   <summary text>
```

All messages include a `[standup]` metadata header since Backboard doesn't support native metadata fields.

## API Endpoints

### `GET /health`

```bash
curl http://localhost:3000/health
# → {"status":"ok"}
```

### `POST /standup/ingest`

Store a standup transcript + extracted data.

```bash
curl -X POST http://localhost:3000/standup/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "team_id": "team-123",
    "user_id": "u-456",
    "date": "2026-02-28",
    "transcript": "Yesterday I worked on auth flow. Today I am starting the dashboard. No blockers.",
    "extracted": {
      "yesterday": "auth flow",
      "today": "dashboard",
      "blockers": "none",
      "tasks": ["dashboard"],
      "confidence": 0.95
    },
    "summary": "Auth done, moving to dashboards"
  }'
```

**Response:**
```json
{ "assistant_id": "...", "thread_id": "...", "stored": true }
```

**Validation errors return 400:**
```json
{
  "error": "Validation failed",
  "details": [{ "path": "date", "message": "date must be YYYY-MM-DD format" }]
}
```

### `GET /standup/thread/:threadId/messages`

Retrieve all messages from a thread.

```bash
curl http://localhost:3000/standup/thread/<thread_id>/messages
```

**Response:**
```json
{
  "thread_id": "...",
  "messages": [
    { "role": "user", "content": "[standup] team=team-123 ..." },
    { "role": "assistant", "content": "[standup] team=team-123 ..." }
  ]
}
```

## Local State

The server caches Backboard IDs in `.backboard_state.json` (auto-created):

```json
{
  "assistant_id": "asst_abc123",
  "threads": {
    "team-123:u-456": "thr_def789",
    "team-123:u-456:2026-02-28": "thr_ghi012"
  }
}
```

Delete this file to force re-creation of all resources.

## Project Structure

```
src/
├── types.ts              # Zod schemas + TypeScript types
├── backboard/
│   ├── client.ts         # REST client wrapper (retries, error handling)
│   └── repo.ts           # Local JSON cache for assistant/thread IDs
├── standup/
│   └── service.ts        # Ingest orchestration
└── server.ts             # Express API
```
