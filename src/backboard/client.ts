import type {
    BackboardAssistant,
    BackboardThread,
    BackboardMessage,
} from "../types.js";

// ─── Configuration ────────────────────────────────────────────────

const BASE_URL = "https://app.backboard.io/api";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// ─── Structured Error ─────────────────────────────────────────────

interface BackboardApiError {
    method: string;
    path: string;
    status: number;
    body: unknown;
    attempt: number;
}

function logError(err: BackboardApiError): void {
    console.error("[BackboardClient] API error:", JSON.stringify(err, null, 2));
}

// ─── Retry Helper ─────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(status: number): boolean {
    return status === 429 || status >= 500;
}

// ─── Client ───────────────────────────────────────────────────────

export class BackboardClient {
    private apiKey: string;

    constructor(apiKey: string) {
        if (!apiKey) {
            throw new Error("BACKBOARD_API_KEY is required");
        }
        this.apiKey = apiKey;
    }

    // ── Core fetch with retries ────────────────────────────────────

    private async request<T>(
        method: string,
        path: string,
        options?: {
            json?: Record<string, unknown>;
            formData?: Record<string, string>;
        }
    ): Promise<T> {
        const url = `${BASE_URL}${path}`;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            const headers: Record<string, string> = {
                "X-API-Key": this.apiKey,
            };

            let body: string | URLSearchParams | undefined;

            if (options?.json) {
                headers["Content-Type"] = "application/json";
                body = JSON.stringify(options.json);
            } else if (options?.formData) {
                // Backboard message endpoint expects form-encoded data
                body = new URLSearchParams(options.formData).toString();
                headers["Content-Type"] = "application/x-www-form-urlencoded";
            }

            try {
                const response = await fetch(url, { method, headers, body });

                if (response.ok) {
                    const data = (await response.json()) as T;
                    return data;
                }

                const errorBody = await response.text().catch(() => "");

                logError({
                    method,
                    path,
                    status: response.status,
                    body: errorBody,
                    attempt,
                });

                if (isRetryable(response.status) && attempt < MAX_RETRIES) {
                    const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
                    console.warn(
                        `[BackboardClient] Retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})...`
                    );
                    await sleep(delay);
                    continue;
                }

                throw new Error(
                    `Backboard API ${method} ${path} failed with status ${response.status}: ${errorBody}`
                );
            } catch (err) {
                if (
                    err instanceof Error &&
                    err.message.startsWith("Backboard API")
                ) {
                    throw err;
                }

                // Network-level error — retry
                console.error(
                    `[BackboardClient] Network error on attempt ${attempt}:`,
                    err
                );

                if (attempt < MAX_RETRIES) {
                    const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
                    await sleep(delay);
                    continue;
                }

                throw new Error(
                    `Backboard API ${method} ${path} failed after ${MAX_RETRIES} attempts: ${err}`
                );
            }
        }

        // Unreachable, but TypeScript needs it
        throw new Error(`Backboard API ${method} ${path} failed unexpectedly`);
    }

    // ── Public Methods ─────────────────────────────────────────────

    /**
     * Create an assistant with a name and system prompt.
     * Returns the full assistant object including assistant_id.
     */
    async createAssistant(
        name: string,
        systemPrompt: string
    ): Promise<BackboardAssistant> {
        console.log(`[BackboardClient] Creating assistant: "${name}"`);
        return this.request<BackboardAssistant>("POST", "/assistants", {
            json: { name, system_prompt: systemPrompt },
        });
    }

    /**
     * Create a thread for the given assistant.
     * Returns the full thread object including thread_id.
     */
    async createThread(assistantId: string): Promise<BackboardThread> {
        console.log(
            `[BackboardClient] Creating thread for assistant: ${assistantId}`
        );
        return this.request<BackboardThread>(
            "POST",
            `/assistants/${assistantId}/threads`,
            { json: {} }
        );
    }

    /**
     * Add a message to a thread.
     *
     * NOTE: Backboard's message endpoint expects form-encoded data,
     * not JSON. We use stream=false and memory=Auto by default.
     */
    async addMessage(
        threadId: string,
        role: "user" | "assistant",
        content: string
    ): Promise<BackboardMessage> {
        console.log(
            `[BackboardClient] Adding ${role} message to thread: ${threadId} (${content.length} chars)`
        );
        return this.request<BackboardMessage>(
            "POST",
            `/threads/${threadId}/messages`,
            {
                formData: {
                    content,
                    role,
                    stream: "false",
                    memory: "Auto",
                },
            }
        );
    }

    /**
     * Retrieve a thread with all its messages.
     * GET /threads/{thread_id} returns { thread_id, messages[] }.
     */
    async getThread(threadId: string): Promise<BackboardThread> {
        console.log(`[BackboardClient] Getting thread: ${threadId}`);
        return this.request<BackboardThread>("GET", `/threads/${threadId}`);
    }
}
