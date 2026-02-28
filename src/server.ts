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
app.use(express.json());

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

// ─── Start Server ────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`\n🚀 StandupBot Backboard server running on port ${PORT}`);
    console.log(`   THREAD_PER_DAY = ${process.env.THREAD_PER_DAY || "false"}`);
    console.log(`   Health:     GET  http://localhost:${PORT}/health`);
    console.log(`   Ingest:     POST http://localhost:${PORT}/standup/ingest`);
    console.log(`   Messages:   GET  http://localhost:${PORT}/standup/thread/:threadId/messages`);
    console.log(`   Store:      POST http://localhost:${PORT}/api/store-transcript`);
    console.log(`   Context:    GET  http://localhost:${PORT}/api/context/:userId\n`);
});
