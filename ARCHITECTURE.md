# StandupBot — Architecture Plan

## Overview

A Slack-integrated voice standup bot. At a configured time, it DMs each team member a link to join a voice call. The bot asks standup questions, listens to their responses, stores the conversation in Backboard.io, and posts a summary to the Slack channel. Over time, it uses conversation history to generate personalized questions for each member.

---

## Tech Stack

| Layer | Tool | Purpose |
|---|---|---|
| Slack integration | Slack Bolt SDK (Node.js) | DMs, slash commands, summary posting |
| Voice agent | ElevenLabs Conversational AI | STT, TTS, real-time conversation |
| LLM | Featherless AI | Question generation, summarization |
| Memory / Storage | Backboard.io | Persistent conversation memory per member |
| Scheduler | node-cron | Triggers standup at configured time |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          SCHEDULER                               │
│                    (node-cron, daily at X time)                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ triggers
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SLACK BOT                                 │
│  - DMs each standup member with a voice call link               │
│  - Collects leader-defined custom questions per member           │
│  - Posts standup summary to team channel after all calls done    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ call link clicked
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                  ELEVENLABS VOICE AGENT                          │
│  - Receives injected context: member history + custom questions  │
│  - Conducts voice standup (STT + TTS + turn-taking)             │
│  - Fires webhook on call end with full transcript               │
└───────────────────────────┬─────────────────────────────────────┘
                            │ webhook → transcript
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BACKEND SERVER                              │
│                                                                  │
│  1. Receives transcript from ElevenLabs webhook                  │
│  2. Stores transcript in Backboard (thread message)              │
│  3. Calls Featherless AI to:                                     │
│     a. Extract key facts / blockers from transcript              │
│     b. Generate personalized questions for next standup          │
│  4. Triggers Slack summary once all members are done             │
└──────────────┬────────────────────────────┬─────────────────────┘
               │                            │
               ▼                            ▼
┌──────────────────────────┐  ┌─────────────────────────────────┐
│      BACKBOARD.IO         │  │         FEATHERLESS AI           │
│                           │  │                                  │
│  One Assistant per member │  │  Model: Llama-3.3-70B-Instruct  │
│  One Thread per standup   │  │  OpenAI-compatible API           │
│  Memory mode: "Auto"      │  │  Used for:                       │
│                           │  │  - Summarization                 │
│  Stores:                  │  │  - Next-question generation      │
│  - Q&A transcripts        │  │  - Fact extraction               │
│  - Blockers & themes      │  │                                  │
│  - Work patterns          │  └─────────────────────────────────┘
└──────────────────────────┘
```

---

## Backboard.io Data Model

Each team member gets their own **Assistant** in Backboard. This keeps memory isolated per person and lets Backboard's Auto memory accumulate personal patterns over time.

```
Assistant (one per team member)
│   system_prompt: "You are a standup memory store for {name}.
│                   Track their blockers, progress, and work patterns."
│
└── Thread (one per standup session)
        └── Messages
                ├── Q: "What did you work on yesterday?"
                ├── A: "{transcript answer}"
                ├── Q: "Any blockers?"
                └── A: "{transcript answer}"
```

**Memory mode:** `"Auto"` — Backboard automatically extracts and retains facts across threads (blockers, recurring themes, delivery patterns).

### API Calls

```
// 1. Create member assistant (one-time setup)
POST /assistants
{ name: "standup-{slack_user_id}", system_prompt: "..." }

// 2. Create new thread for today's standup
POST /assistants/{assistant_id}/threads
{}

// 3. Store each Q&A pair from transcript
POST /threads/{thread_id}/messages
{ content: "Q: {question}\nA: {answer}", memory: "Auto" }
```

---

## ElevenLabs Integration

ElevenLabs Conversational AI is used for the full voice call. Before each call, we inject a dynamic first-turn prompt with:

1. The member's name and role
2. Backboard history summary (blockers, themes from recent standups)
3. Any custom questions the standup leader has set for that member
4. Default standup questions as fallback

**Call lifecycle:**
```
POST /v1/convai/conversations  ← start call with injected prompt
        ↓
    voice call runs
        ↓
Webhook fires → GET /v1/convai/conversations/{id}/transcript
```

---

## Featherless AI Integration

Featherless is OpenAI API-compatible — just swap the base URL.

```js
const client = new OpenAI({
  baseURL: "https://api.featherless.ai/v1",
  apiKey: process.env.FEATHERLESS_API_KEY,
});
```

**Used for two tasks:**

**1. After call — extract facts:**
```
Prompt: "Given this standup transcript, extract:
- Key accomplishments
- Blockers mentioned
- Notable patterns or risks
Return as JSON."
```

**2. Before next call — generate questions:**
```
Prompt: "Given this member's standup history (below), generate
3 personalized follow-up questions for tomorrow's standup.
Focus on unresolved blockers and in-progress work.
History: {backboard_summary}"
```

---

## Slack Bot Commands

| Command | Who | Description |
|---|---|---|
| `/standup config time 9:30am` | Leader | Set daily standup time |
| `/standup config members @a @b @c` | Leader | Set standup members |
| `/standup ask @member "question"` | Leader | Add a custom question for a member |
| `/standup run` | Leader | Trigger standup immediately |

---

## Default Standup Questions (First Run)

When there's no history for a member, the bot asks:

1. What did you work on yesterday?
2. What are you working on today?
3. Any blockers or things slowing you down?

---

## Question Priority Order (Per Call)

```
1. Leader-defined custom questions (highest priority)
2. Featherless AI personalized questions (based on Backboard history)
3. Default standup questions (fallback if no history)
```

---

## Summary Format (Posted to Slack)

```
📋 Standup Summary — Feb 28, 2026

👤 Alice
  Yesterday: Finished auth flow PR
  Today: Starting on dashboard component
  Blockers: Waiting on design review

👤 Bob
  Yesterday: Fixed the CI pipeline
  Today: Reviewing Alice's PR
  Blockers: None

👤 Carol
  Yesterday: Customer calls
  Today: Writing specs for v2
  Blockers: Needs DB schema decision ⚠️
```

---

## Team Split

| Person | Owns |
|---|---|
| **Person 1** | Slack bot, slash commands, scheduler, summary posting |
| **Person 2** | ElevenLabs call setup, prompt injection, webhook handler |
| **Person 3** | Backboard integration, Featherless AI question gen + summarization |

### Dependencies
- Person 3 must expose two functions for Person 2: `getContextForMember(userId)` and `storeTranscript(userId, transcript)`
- Person 1 must expose `postSummary(summaries[])` for Person 3 to call after processing

---

## Environment Variables

```env
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
ELEVENLABS_API_KEY=
ELEVENLABS_AGENT_ID=
FEATHERLESS_API_KEY=
BACKBOARD_API_KEY=
```
