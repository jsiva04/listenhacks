import "dotenv/config";
import { BackboardClient } from "./backboard/client.js";
import { BackboardRepo, buildThreadKey } from "./backboard/repo.js";
import { StandupService } from "./standup/service.js";
import { FeatherlessClient } from "./featherless/client.js";

const backboardClient = new BackboardClient(process.env.BACKBOARD_API_KEY!);
const backboardRepo = new BackboardRepo();
const standupService = new StandupService(backboardClient, backboardRepo);
const featherlessClient = new FeatherlessClient();

export async function get_context_for_member(
  user_id: string
): Promise<{ historyContext: string, customQuestions: string[] }> {
  // Hardcode a default teamId since ElevenLabs isn't tracking teams
  const teamId = "default-team";

  console.log(`[Integration] Fetching context for user=${user_id}`);

  try {
    const assistantId = await backboardRepo.getOrCreateAssistant(backboardClient);

    const threadKey = buildThreadKey(teamId, user_id, "history");
    const threadId = await backboardRepo.getOrCreateThread(backboardClient, assistantId, threadKey);

    const thread = await backboardClient.getThread(threadId);

    if (!thread.messages || thread.messages.length === 0) {
      console.log(`[Integration] No history found for user=${user_id}. Using defaults.`);
      return {
        historyContext: "No previous standup history recorded.",
        customQuestions: ["What did you work on yesterday?", "What are you working on today?", "Any blockers?"]
      };
    }

    const recentMessages = thread.messages.slice(-10);
    const historyText = recentMessages.map(msg => `[${msg.role.toUpperCase()}]: ${msg.content}`).join("\n\n");

    const customQuestions = await featherlessClient.generateQuestions(historyText);

    return {
      historyContext: historyText,
      customQuestions
    };
  } catch (err) {
    console.error(`[Integration] Failed getting context for ${user_id}:`, err);
    throw err;
  }
}

export async function store_transcript(
  user_id: string,
  full_transcript: string,
  conversation_id?: string
): Promise<{ summaryForSlack: string | undefined }> {
  // Hardcode defaults since ElevenLabs only passes user/transcript
  const teamId = "default-team";
  const date = new Date().toISOString().split('T')[0];

  console.log(`[Integration] Processing new transcript for user=${user_id} (conv: ${conversation_id || 'none'})`);

  const { extracted, summary } = await featherlessClient.extractData(full_transcript);

  await standupService.ingest({
    team_id: teamId,
    user_id: user_id,
    date,
    transcript: full_transcript,
    extracted,
    summary
  });

  console.log(`[Integration] Finished storing transcript and extracted data in Backboard for ${user_id}`);

  return { summaryForSlack: summary };
}
