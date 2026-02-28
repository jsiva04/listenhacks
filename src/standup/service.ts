import type { IngestPayload, IngestResult } from "../types.js";
import { BackboardClient } from "../backboard/client.js";
import { BackboardRepo, buildThreadKey } from "../backboard/repo.js";

// ─── Message Formatting ──────────────────────────────────────────

function metadataHeader(
    teamId: string,
    userId: string,
    date: string
): string {
    return `[standup] team=${teamId} user=${userId} date=${date}`;
}

function formatTranscript(payload: IngestPayload): string {
    return [
        metadataHeader(payload.team_id, payload.user_id, payload.date),
        "--- TRANSCRIPT ---",
        payload.transcript,
    ].join("\n");
}

function formatExtracted(payload: IngestPayload): string {
    return [
        metadataHeader(payload.team_id, payload.user_id, payload.date),
        "--- EXTRACTED ---",
        JSON.stringify(payload.extracted, null, 2),
    ].join("\n");
}

function formatSummary(payload: IngestPayload): string {
    return [
        metadataHeader(payload.team_id, payload.user_id, payload.date),
        "--- SUMMARY ---",
        payload.summary,
    ].join("\n");
}

// ─── Service ─────────────────────────────────────────────────────

export class StandupService {
    private client: BackboardClient;
    private repo: BackboardRepo;

    constructor(client: BackboardClient, repo: BackboardRepo) {
        this.client = client;
        this.repo = repo;
    }

    /**
     * Ingest a standup payload into Backboard.
     *
     * 1. Ensure an assistant exists (create-once, reuse)
     * 2. Ensure a thread exists for this team/user(/date)
     * 3. Store transcript as a "user" message
     * 4. Store extracted JSON as an "assistant" message
     * 5. Optionally store summary as an "assistant" message
     */
    async ingest(payload: IngestPayload): Promise<IngestResult> {
        console.log(
            `[StandupService] Ingesting standup: team=${payload.team_id} user=${payload.user_id} date=${payload.date}`
        );

        // 1. Get or create assistant
        const assistantId = await this.repo.getOrCreateAssistant(this.client);

        // 2. Get or create thread
        const threadKey = buildThreadKey(
            payload.team_id,
            payload.user_id,
            payload.date
        );
        const threadId = await this.repo.getOrCreateThread(
            this.client,
            assistantId,
            threadKey
        );

        // 3. Store transcript as user message
        await this.client.addMessage(
            threadId,
            "user",
            formatTranscript(payload)
        );

        // 4. Store extracted data as assistant message
        await this.client.addMessage(
            threadId,
            "assistant",
            formatExtracted(payload)
        );

        // 5. Optionally store summary
        if (payload.summary) {
            await this.client.addMessage(
                threadId,
                "assistant",
                formatSummary(payload)
            );
        }

        console.log(
            `[StandupService] Ingest complete: assistant=${assistantId} thread=${threadId}`
        );

        return {
            assistant_id: assistantId,
            thread_id: threadId,
            stored: true,
        };
    }
}
