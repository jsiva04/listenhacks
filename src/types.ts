import { z } from "zod";

// ─── Ingest Payload ───────────────────────────────────────────────

export const IngestPayloadSchema = z.object({
    team_id: z.string().min(1, "team_id is required"),
    user_id: z.string().min(1, "user_id is required"),
    date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD format"),
    transcript: z.string().min(1, "transcript is required"),
    extracted: z.object({
        yesterday: z.string().optional(),
        today: z.string().optional(),
        blockers: z.string().optional(),
        tasks: z.array(z.string()).optional(),
        confidence: z.number().min(0).max(1).optional(),
    }),
    summary: z.string().optional(),
});

export type IngestPayload = z.infer<typeof IngestPayloadSchema>;

// ─── Backboard API Response Types ─────────────────────────────────

export interface BackboardAssistant {
    assistant_id: string;
    name: string;
    system_prompt?: string;
}

export interface BackboardThread {
    thread_id: string;
    assistant_id?: string;
    messages?: BackboardMessage[];
    created_at?: string;
}

export interface BackboardMessage {
    message_id?: string;
    thread_id?: string;
    role: "user" | "assistant" | "tool";
    content: string;
}

// ─── Ingest Result ────────────────────────────────────────────────

export interface IngestResult {
    assistant_id: string;
    thread_id: string;
    stored: boolean;
}

// ─── Local State File ─────────────────────────────────────────────

export interface BackboardState {
    assistant_id: string | null;
    threads: Record<string, string>; // key → thread_id
}
