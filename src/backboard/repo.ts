import fs from "node:fs";
import path from "node:path";
import type { BackboardState } from "../types.js";
import type { BackboardClient } from "./client.js";

// ─── Configuration ────────────────────────────────────────────────

const STATE_FILE = path.resolve(
    process.cwd(),
    ".backboard_state.json"
);

const ASSISTANT_NAME = "standup-bot";
const ASSISTANT_SYSTEM_PROMPT = `You are a standup memory store for a development team.
Track each member's daily progress, blockers, accomplishments, and work patterns.
When information is stored, acknowledge it briefly.
Do not fabricate information — only reference what has been explicitly stored.`;

// ─── State Helpers ────────────────────────────────────────────────

function loadState(): BackboardState {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const raw = fs.readFileSync(STATE_FILE, "utf-8");
            return JSON.parse(raw) as BackboardState;
        }
    } catch (err) {
        console.warn(
            "[BackboardRepo] Could not load state file, starting fresh:",
            err
        );
    }
    return { assistant_id: null, threads: {} };
}

function saveState(state: BackboardState): void {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

// ─── Thread Key Builder ───────────────────────────────────────────

/**
 * Build the cache key for a thread.
 *
 * When THREAD_PER_DAY=true:  "team-123:u-456:2026-02-28"
 * When THREAD_PER_DAY=false: "team-123:u-456"
 */
export function buildThreadKey(
    teamId: string,
    userId: string,
    date: string
): string {
    const perDay = process.env.THREAD_PER_DAY === "true";
    return perDay ? `${teamId}:${userId}:${date}` : `${teamId}:${userId}`;
}

// ─── Repository ───────────────────────────────────────────────────

export class BackboardRepo {
    /**
     * Return the cached assistant_id, or create a new assistant and cache it.
     */
    async getOrCreateAssistant(client: BackboardClient): Promise<string> {
        const state = loadState();

        if (state.assistant_id) {
            console.log(
                `[BackboardRepo] Using cached assistant: ${state.assistant_id}`
            );
            return state.assistant_id;
        }

        console.log("[BackboardRepo] No cached assistant — creating one...");
        const assistant = await client.createAssistant(
            ASSISTANT_NAME,
            ASSISTANT_SYSTEM_PROMPT
        );

        state.assistant_id = assistant.assistant_id;
        saveState(state);

        console.log(
            `[BackboardRepo] Cached new assistant: ${assistant.assistant_id}`
        );
        return assistant.assistant_id;
    }

    /**
     * Return the cached thread_id for the given key, or create a new
     * thread and cache it.
     */
    async getOrCreateThread(
        client: BackboardClient,
        assistantId: string,
        key: string
    ): Promise<string> {
        const state = loadState();

        if (state.threads[key]) {
            console.log(
                `[BackboardRepo] Using cached thread for key "${key}": ${state.threads[key]}`
            );
            return state.threads[key];
        }

        console.log(
            `[BackboardRepo] No cached thread for key "${key}" — creating one...`
        );
        const thread = await client.createThread(assistantId);

        state.threads[key] = thread.thread_id;
        saveState(state);

        console.log(
            `[BackboardRepo] Cached new thread for key "${key}": ${thread.thread_id}`
        );
        return thread.thread_id;
    }
}
