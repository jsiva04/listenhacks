import "dotenv/config";
import { BackboardClient } from "./backboard/client.js";

async function testConnection() {
    console.log("Testing Backboard API Connection...");

    const apiKey = process.env.BACKBOARD_API_KEY;
    if (!apiKey) {
        console.error("❌ BACKBOARD_API_KEY is missing from .env");
        process.exit(1);
    }

    console.log(`Using API Key: ${apiKey.substring(0, 10)}...`);

    const client = new BackboardClient(apiKey);

    try {
        console.log("Attempting to create a test assistant...");
        const assistant = await client.createAssistant("connection-test", "Just testing the API key connection.");

        console.log("✅ Success! Connected to Backboard API.");
        console.log(`Created Assistant ID: ${assistant.assistant_id}`);

        console.log("\nAttempting to create a thread...");
        const thread = await client.createThread(assistant.assistant_id);
        console.log(`✅ Created Thread ID: ${thread.thread_id}`);

        console.log("\nAll connection tests passed! The API key is fully working.");
    } catch (error) {
        console.error("\n❌ Connection Failed!");
        console.error(error instanceof Error ? error.message : String(error));
    }
}

testConnection();
