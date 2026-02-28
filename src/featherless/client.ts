import OpenAI from "openai";
import type { IngestPayload } from "../types.js";

const FEATHERLESS_API_KEY = process.env.FEATHERLESS_API_KEY;

// The architecture mentions using the OpenAI SDK pointing at Featherless API
const openai = new OpenAI({
    apiKey: FEATHERLESS_API_KEY,
    baseURL: "https://api.featherless.ai/v1",
});

// User requested this specific model
const MODEL = "Qwen/Qwen2.5-7B-Instruct";

export class FeatherlessClient {
    /**
     * 1. Extract facts from raw transcript
     */
    async extractData(transcript: string): Promise<
        Pick<IngestPayload, "extracted" | "summary">
    > {
        console.log(`[Featherless] Extracting data from transcript (${transcript.length} chars)...`);

        const prompt = `You are an AI assistant that extracts daily standup data from voice transcripts.

TRANSCRIPT:
"""
${transcript}
"""

Extract the following information from the transcript and return ONLY a valid JSON object. Do NOT include markdown blocks (\`\`\`json) — just raw JSON.

FORMAT:
{
  "yesterday": "What the person accomplished yesterday (string, max 1 sentence)",
  "today": "What the person plans to do today (string, max 1 sentence)",
  "blockers": "Any blockers mentioned (string, or 'None' if none)",
  "tasks": ["array of", "short task names", "mentioned"],
  "summary": "A 1-sentence summary of their entire update written in the third person (e.g., 'Alice finished...')"
}`;

        const completion = await openai.chat.completions.create({
            model: MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1, // Low temp for more deterministic extraction
        });

        const responseText = completion.choices[0]?.message.content?.trim();
        if (!responseText) {
            throw new Error("Featherless returned an empty response");
        }

        try {
            // Sometimes LLMs still wrap in markdown despite being told not to
            const cleanJson = responseText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
            const parsed = JSON.parse(cleanJson);

            // We map the flat summary out from the parsed object into the return structure
            const summary = parsed.summary;
            delete parsed.summary;

            return {
                extracted: {
                    yesterday: parsed.yesterday,
                    today: parsed.today,
                    blockers: parsed.blockers,
                    tasks: parsed.tasks,
                    confidence: 0.9, // Hardcoded for now since LLM confidence is complex
                },
                summary: summary,
            };
        } catch (err) {
            console.error("[Featherless] Failed to parse JSON response:", responseText);
            throw new Error(`Invalid JSON from Featherless: ${err}`);
        }
    }

    /**
     * 2. Generate custom questions for the next standup based on Backboard history
     */
    async generateQuestions(memberHistory: string): Promise<string[]> {
        console.log(`[Featherless] Generating questions from ${memberHistory.length} chars of history...`);

        const prompt = `Given this team member's standup history, generate 3 personalized follow-up questions for tomorrow's standup.
Focus on unresolved blockers and in-progress work.

HISTORY:
"""
${memberHistory}
"""

Return ONLY a valid JSON array of strings containing exactly 3 questions. Do NOT wrap in markdown.
Example format: ["Did you finish the API?", "Is design still blocking you?", "What's next?"]`;

        const completion = await openai.chat.completions.create({
            model: MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7, // Slightly higher temp for better questions
        });

        const responseText = completion.choices[0]?.message.content?.trim();
        if (!responseText) {
            return ["What did you work on yesterday?", "What are you working on today?", "Any blockers?"];
        }

        try {
            const cleanJson = responseText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
            return JSON.parse(cleanJson) as string[];
        } catch (err) {
            console.error("[Featherless] Failed to parse questions JSON:", responseText);
            // Fallback
            return ["What did you work on yesterday?", "What are you working on today?", "Any blockers?"];
        }
    }
}
