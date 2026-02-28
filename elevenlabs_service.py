import os
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
import httpx

load_dotenv()

app = FastAPI(title='StandupBot - ElevenLabs Service')

ELEVENLABS_API_KEY = os.getenv('ELEVENLABS_API_KEY', '')
ELEVENLABS_AGENT_ID = os.getenv('ELEVENLABS_AGENT_ID', '')
ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1'
SLACK_WEBHOOK_URL = os.getenv('SLACK_WEBHOOK_URL', '')


# ---------------------------------------------------------------------------
# Placeholder integrations for Person 3
# ---------------------------------------------------------------------------
# TODO [Person 3]: Replace with real Backboard.io context retrieval.
# This function should query the member's Backboard assistant/thread to build
# a summary of recent standup history, blockers, and personalized questions.
async def get_context_for_member(user_id: str) -> str:
    '''
    Placeholder — returns mock context for a given team member.
    Person 3 will replace this with the Backboard + Featherless AI integration
    that fetches conversation history and generates personalized questions.
    '''
    return (
        f'Member {user_id} — recent context:\n'
        '• Yesterday: Worked on API integration\n'
        '• Blocker: Waiting on design review\n'
        '• Custom question from lead: How is the migration going?'
    )


# TODO [Person 3]: Replace with real Backboard.io transcript storage.
# This function should create a new thread (or append to today's thread)
# on the member's Backboard assistant and store the Q&A pairs with
# memory mode 'Auto'.
async def store_transcript(user_id: str, transcript: str) -> None:
    '''
    Placeholder — stores the transcript for a given team member.
    Person 3 will replace this with the Backboard.io storage logic
    (create thread → post messages → trigger Featherless summarization).
    '''
    print(f'[store_transcript] user_id={user_id}, transcript length={len(transcript)}')


# ---------------------------------------------------------------------------
# Slack helpers
# ---------------------------------------------------------------------------
async def send_to_slack(message: str) -> None:
    '''
    Send a message to the configured Slack channel via Incoming Webhook.
    Silently logs a warning if SLACK_WEBHOOK_URL is not set.
    '''
    if not SLACK_WEBHOOK_URL:
        print('[send_to_slack] SLACK_WEBHOOK_URL is not configured — skipping.')
        return

    async with httpx.AsyncClient() as client:
        response = await client.post(
            SLACK_WEBHOOK_URL,
            json={'text': message},
            timeout=10.0,
        )

    if response.status_code != 200:
        print(
            f'[send_to_slack] Slack returned {response.status_code}: '
            f'{response.text}'
        )


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------
class StartStandupRequest(BaseModel):
    user_id: str


class StartStandupResponse(BaseModel):
    signed_url: str
    agent_id: str


# ---------------------------------------------------------------------------
# POST /api/standup/start
# ---------------------------------------------------------------------------
@app.post('/api/standup/start', response_model=StartStandupResponse)
async def start_standup(body: StartStandupRequest):
    '''
    Kick off an ElevenLabs Conversational AI call for the given user.

    1. Fetch personalised context from Backboard (Person 3 placeholder).
    2. GET a signed WebSocket URL from ElevenLabs for this agent.
    3. Return the signed_url so the frontend / Slack bot can open a
       WebSocket conversation and inject dynamic_variables at handshake.

    The client that opens the WebSocket should send an initial config
    message containing the dynamic_variables (user_name, context) as
    part of the conversation_config during the WebSocket handshake.
    '''
    user_id = body.user_id

    # Step 1 — gather context (Person 3 placeholder)
    context = await get_context_for_member(user_id)

    # Step 2 — get a signed URL from ElevenLabs
    headers = {
        'xi-api-key': ELEVENLABS_API_KEY,
    }

    params = {
        'agent_id': ELEVENLABS_AGENT_ID,
    }

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f'{ELEVENLABS_BASE_URL}/convai/conversation/get-signed-url',
            headers=headers,
            params=params,
            timeout=30.0,
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail=f'ElevenLabs API error: {response.text}',
        )

    data = response.json()
    signed_url = data.get('signed_url', '')

    if not signed_url:
        raise HTTPException(
            status_code=502,
            detail='ElevenLabs response missing signed_url',
        )

    # Log the context that the client should inject at handshake
    print(
        f'[start_standup] user_id={user_id} | '
        f'dynamic_variables to inject: user_name={user_id}, '
        f'context length={len(context)}'
    )

    return StartStandupResponse(
        signed_url=signed_url,
        agent_id=ELEVENLABS_AGENT_ID,
    )


# ---------------------------------------------------------------------------
# POST /api/webhooks/elevenlabs
# ---------------------------------------------------------------------------
@app.post('/api/webhooks/elevenlabs')
async def elevenlabs_webhook(request: Request):
    '''
    Webhook handler called by ElevenLabs when a conversation ends.

    1. Extract conversation_id and user_id from the webhook payload.
    2. GET the conversation details (incl. transcript) from ElevenLabs.
    3. Parse the transcript into plain text.
    4. Hand it to store_transcript (Person 3 placeholder).
    '''
    payload = await request.json()

    conversation_id = payload.get('conversation_id')
    user_id = payload.get('user_id')

    if not conversation_id or not user_id:
        raise HTTPException(
            status_code=400,
            detail='Missing conversation_id or user_id in webhook payload',
        )

    # Fetch conversation details (includes transcript) from ElevenLabs
    headers = {
        'xi-api-key': ELEVENLABS_API_KEY,
    }

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f'{ELEVENLABS_BASE_URL}/convai/conversations/{conversation_id}',
            headers=headers,
            timeout=30.0,
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail=f'Failed to fetch conversation: {response.text}',
        )

    conversation_data = response.json()

    # Parse transcript entries into readable text
    transcript_entries = conversation_data.get('transcript', [])
    lines: list[str] = []
    for entry in transcript_entries:
        role = entry.get('role', 'unknown')
        message = entry.get('message', '')
        lines.append(f'{role}: {message}')

    full_transcript = '\n'.join(lines)

    # Hand off to Person 3's storage integration
    await store_transcript(user_id, full_transcript)

    # Forward a short summary to Slack
    summary = (
        f':speech_balloon: *Standup complete for {user_id}*\n'
        f'Conversation `{conversation_id}` — '
        f'{len(transcript_entries)} exchanges recorded.'
    )
    await send_to_slack(summary)

    return {'status': 'ok', 'conversation_id': conversation_id}


# ---------------------------------------------------------------------------
# POST /api/slack-notify — ad-hoc Slack notifications
# ---------------------------------------------------------------------------
class SlackNotifyRequest(BaseModel):
    message: str


@app.post('/api/slack-notify')
async def slack_notify(body: SlackNotifyRequest):
    '''
    Send an arbitrary message to the configured Slack channel.
    Useful for the ElevenLabs agent to call as a webhook tool,
    or for any other service that needs to post to Slack.
    '''
    if not SLACK_WEBHOOK_URL:
        raise HTTPException(
            status_code=500,
            detail='SLACK_WEBHOOK_URL is not configured on the server.',
        )

    await send_to_slack(body.message)
    return {'status': 'ok'}
