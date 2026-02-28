import "dotenv/config";
import express from "express";
import { ZodError } from "zod";
import { IngestPayloadSchema } from "./types.js";
import { BackboardClient } from "./backboard/client.js";
import { BackboardRepo } from "./backboard/repo.js";
import { StandupService } from "./standup/service.js";

// ─── Bootstrap ───────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3000", 10);
const API_KEY = process.env.BACKBOARD_API_KEY;

if (!API_KEY) {
    console.error("❌ BACKBOARD_API_KEY is not set. See .env.example.");
    process.exit(1);
}

const client = new BackboardClient(API_KEY);
const repo = new BackboardRepo();
const service = new StandupService(client, repo);

// ─── Express App ─────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "10mb" }));

// ── Health check ─────────────────────────────────────────────────

app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

// ── POST /standup/ingest ─────────────────────────────────────────

app.post("/standup/ingest", async (req, res) => {
    try {
        // Validate payload
        const payload = IngestPayloadSchema.parse(req.body);

        // Ingest into Backboard
        const result = await service.ingest(payload);

        res.status(200).json(result);
    } catch (err) {
        if (err instanceof ZodError) {
            res.status(400).json({
                error: "Validation failed",
                details: err.errors.map((e) => ({
                    path: e.path.join("."),
                    message: e.message,
                })),
            });
            return;
        }

        console.error("[Server] Ingest error:", err);
        res.status(500).json({
            error: "Internal server error",
            message: err instanceof Error ? err.message : String(err),
        });
    }
});

// ── GET /standup/thread/:threadId/messages ────────────────────────

app.get("/standup/thread/:threadId/messages", async (req, res) => {
    try {
        const { threadId } = req.params;
        const thread = await client.getThread(threadId);

        res.status(200).json({
            thread_id: thread.thread_id,
            messages: thread.messages ?? [],
        });
    } catch (err) {
        console.error("[Server] Get messages error:", err);
        res.status(500).json({
            error: "Internal server error",
            message: err instanceof Error ? err.message : String(err),
        });
    }
});

// ══════════════════════════════════════════════════════════════════
// BRIDGE ENDPOINTS — Person 2 (Python/ElevenLabs) calls these
// ══════════════════════════════════════════════════════════════════

import { store_transcript, get_context_for_member } from "./index.js";

// ── POST /api/store-transcript ───────────────────────────────────
// Person 2 calls this after the ElevenLabs call ends.
// Body: { user_id: string, full_transcript: string, conversation_id?: string }

app.post("/api/store-transcript", async (req, res) => {
    try {
        const { user_id, full_transcript, conversation_id } = req.body;

        if (!user_id || !full_transcript) {
            res.status(400).json({
                error: "Missing required fields: user_id, full_transcript",
            });
            return;
        }

        const result = await store_transcript(user_id, full_transcript, conversation_id);

        res.status(200).json({
            success: true,
            summary: result.summaryForSlack,
        });
    } catch (err) {
        console.error("[Server] store-transcript error:", err);
        res.status(500).json({
            error: "Internal server error",
            message: err instanceof Error ? err.message : String(err),
        });
    }
});

// ── GET /api/context/:userId ─────────────────────────────────────
// Person 2 calls this before starting the ElevenLabs call.
// Returns a plain context string to inject into the voice agent prompt.

app.get("/api/context/:userId", async (req, res) => {
    try {
        const { userId } = req.params;

        const result = await get_context_for_member(userId);

        // Format into a single string for ElevenLabs {custom_context} injection
        const contextString = [
            "Recent history:",
            result.historyContext,
            "",
            "Suggested follow-up questions:",
            ...result.customQuestions.map((q, i) => `${i + 1}. ${q}`),
        ].join("\n");

        res.status(200).json({
            user_id: userId,
            context: contextString,
        });
    } catch (err) {
        console.error("[Server] get-context error:", err);
        res.status(500).json({
            error: "Internal server error",
            message: err instanceof Error ? err.message : String(err),
        });
    }
});

// ══════════════════════════════════════════════════════════════════
// ELEVENLABS WEBHOOK — receives post-call data directly
// ══════════════════════════════════════════════════════════════════

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const SLACK_STANDUP_CHANNEL = process.env.SLACK_STANDUP_CHANNEL || "";

function supabaseHeaders() {
    return {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
    };
}

app.post("/api/webhooks/elevenlabs", async (req, res) => {
    console.log("[Webhook] Received ElevenLabs post-call webhook");
    console.log("[Webhook] Full payload:", JSON.stringify(req.body, null, 2));

    const payload = req.body;
    const data = payload.data || payload;
    const conversation_id = data.conversation_id || payload.conversation_id;

    if (!conversation_id) {
        res.status(400).json({ error: "Missing conversation_id" });
        return;
    }

    // Respond IMMEDIATELY so ElevenLabs/ngrok don't time out
    res.status(200).json({ status: "ok", conversation_id });

    // Process everything in background
    (async () => {
        try {
            const today = new Date().toISOString().split("T")[0];
            let user_id = "unknown-user";

            try {
                const supaRes = await fetch(
                    `${SUPABASE_URL}/rest/v1/standup_responses?date=eq.${today}&status=eq.called&order=created_at.desc&limit=1`,
                    { headers: supabaseHeaders() }
                );
                const rows = await supaRes.json();
                if (Array.isArray(rows) && rows.length > 0) {
                    user_id = rows[0].slack_user_id;
                } else {
                    console.warn("[Webhook] No Supabase row — using fallback user_id");
                }
            } catch {
                console.warn("[Webhook] Supabase lookup failed");
            }

            console.log(`[Webhook] User: ${user_id} | conversation: ${conversation_id}`);

            // Fetch transcript from ElevenLabs
            const elRes = await fetch(
                `https://api.elevenlabs.io/v1/convai/conversations/${conversation_id}`,
                { headers: { "xi-api-key": ELEVENLABS_API_KEY } }
            );

            if (!elRes.ok) {
                console.error(`[Webhook] ElevenLabs API error: ${elRes.status} ${await elRes.text()}`);
                return;
            }

            const conversationData = await elRes.json();
            const transcriptEntries = conversationData.transcript || [];
            const full_transcript = transcriptEntries
                .map((e: { role?: string; message?: string }) => `${e.role || "unknown"}: ${e.message || ""}`)
                .join("\n");

            console.log(`[Webhook] Transcript (${full_transcript.length} chars):\n${full_transcript}`);

            // Backboard + Featherless pipeline
            const result = await store_transcript(user_id, full_transcript, conversation_id);

            // Mark completed in Supabase
            if (user_id !== "unknown-user") {
                await fetch(
                    `${SUPABASE_URL}/rest/v1/standup_responses?date=eq.${today}&slack_user_id=eq.${user_id}`,
                    {
                        method: "PATCH",
                        headers: supabaseHeaders(),
                        body: JSON.stringify({ status: "completed" }),
                    }
                );
            }

            // Post summary to Slack channel
            if (SLACK_BOT_TOKEN) {
                try {
                    // Find the standup channel
                    let channelId = SLACK_STANDUP_CHANNEL;

                    // If no channel set in env, try Supabase config
                    if (!channelId) {
                        const cfgRes = await fetch(
                            `${SUPABASE_URL}/rest/v1/config?id=eq.1&select=standup_channel`,
                            { headers: supabaseHeaders() }
                        );
                        const cfgRows = await cfgRes.json();
                        if (Array.isArray(cfgRows) && cfgRows.length > 0) {
                            channelId = cfgRows[0].standup_channel;
                        }
                    }

                    if (channelId) {
                        await fetch("https://slack.com/api/chat.postMessage", {
                            method: "POST",
                            headers: {
                                "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
                                "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                                channel: channelId,
                                text: `📋 *Standup Update* — ${user_id}\n\n${result.summaryForSlack}`,
                            }),
                        });
                        console.log(`[Webhook] 📨 Summary posted to Slack channel ${channelId}`);
                    } else {
                        console.warn("[Webhook] No Slack channel configured — skipping post");
                    }
                } catch (slackErr) {
                    console.error("[Webhook] Slack post failed:", slackErr);
                }
            }

            console.log(`[Webhook] ✅ Done! Summary: ${result.summaryForSlack}`);
        } catch (err) {
            console.error("[Webhook] Background processing error:", err);
        }
    })();
});

// ─── Start Server ────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`\n🚀 StandupBot Backboard server running on port ${PORT}`);
    console.log(`   THREAD_PER_DAY = ${process.env.THREAD_PER_DAY || "false"}`);
    console.log(`   Health:     GET  http://localhost:${PORT}/health`);
    console.log(`   Ingest:     POST http://localhost:${PORT}/standup/ingest`);
    console.log(`   Messages:   GET  http://localhost:${PORT}/standup/thread/:threadId/messages`);
    console.log(`   Store:      POST http://localhost:${PORT}/api/store-transcript`);
    console.log(`   Context:    GET  http://localhost:${PORT}/api/context/:userId`);
    console.log(`   Webhook:    POST http://localhost:${PORT}/api/webhooks/elevenlabs\n`);
});

