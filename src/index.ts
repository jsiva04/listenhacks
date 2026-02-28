import "dotenv/config";
import { BackboardClient } from "./backboard/client.js";
import { BackboardRepo, buildThreadKey } from "./backboard/repo.js";
import { StandupService } from "./standup/service.js";
import { FeatherlessClient } from "./featherless/client.js";

const backboardClient = new BackboardClient(process.env.BACKBOARD_API_KEY!);
const backboardRepo = new BackboardRepo();
const standupService = new StandupService(backboardClient, backboardRepo);
const featherlessClient = new FeatherlessClient();

export async function getContextForMember(
  teamId: string, 
  userId: string
): Promise<{ historyContext: string, customQuestions: string[] }> {
  console.log(`[Integration] Fetching context for team=${teamId} user=${userId}`);
  
  try {
    const assistantId = await backboardRepo.getOrCreateAssistant(backboardClient);
    
    const threadKey = buildThreadKey(teamId, userId, "history");
    const threadId = await backboardRepo.getOrCreateThread(backboardClient, assistantId, threadKey);
    
    const thread = await backboardClient.getThread(threadId);
    
    if (!thread.messages || thread.messages.length === 0) {
       console.log(`[Integration] No history found for user=${userId}. Using defaults.`);
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
    console.error(`[Integration] Failed getting context for ${userId}:`, err);
    throw err;
  }
}

export async function storeTranscript(
  teamId: string, 
  userId: string, 
  date: string, 
  transcript: string
): Promise<{ summaryForSlack: string | undefined }> {
  console.log(`[Integration] Processing new transcript for team=${teamId} user=${userId}`);
  
  const { extracted, summary } = await featherlessClient.extractData(transcript);
  
  await standupService.ingest({
    team_id: teamId,
    user_id: userId,
    date,
    transcript,
    extracted,
    summary
  });
  
  console.log(`[Integration] Finished storing transcript and extracted data in Backboard for ${userId}`);
  
  return { summaryForSlack: summary };
}
