import os
from datetime import date
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel
import httpx

load_dotenv()

app = FastAPI(title='StandupBot - ElevenLabs Service')

ELEVENLABS_API_KEY = os.getenv('ELEVENLABS_API_KEY', '')
ELEVENLABS_AGENT_ID = os.getenv('ELEVENLABS_AGENT_ID', '')
ELEVENLABS_CALL_URL = os.getenv('ELEVENLABS_CALL_URL', '')  # the talk-to link
ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1'
SLACK_BOT_TOKEN = os.getenv('SLACK_BOT_TOKEN', '')
SUPABASE_URL = os.getenv('SUPABASE_URL', '')
SUPABASE_ANON_KEY = os.getenv('SUPABASE_ANON_KEY', '')


def supabase_headers():
    return {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': f'Bearer {SUPABASE_ANON_KEY}',
        'Content-Type': 'application/json',
    }


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
# Slack helper
# ---------------------------------------------------------------------------
async def send_slack_dm(user_id: str, text: str) -> None:
    '''Open a DM with the user and post a message.'''
    async with httpx.AsyncClient() as client:
        # Open DM channel
        dm_res = await client.post(
            'https://slack.com/api/conversations.open',
            headers={'Authorization': f'Bearer {SLACK_BOT_TOKEN}'},
            json={'users': user_id},
        )
        channel_id = dm_res.json().get('channel', {}).get('id')
        if not channel_id:
            print(f'[send_slack_dm] Could not open DM for {user_id}')
            return

        # Post message
        await client.post(
            'https://slack.com/api/chat.postMessage',
            headers={'Authorization': f'Bearer {SLACK_BOT_TOKEN}'},
            json={'channel': channel_id, 'text': text},
        )


# ---------------------------------------------------------------------------
# GET /call  — auto-connect page that injects dynamicVariables
# ---------------------------------------------------------------------------
@app.get('/call', response_class=HTMLResponse)
async def call_page(user_id: str = '', user_name: str = ''):
    if not user_id:
        return HTMLResponse('<h2>Missing user_id</h2>', status_code=400)

    # Upsert a standup_responses row for today so the webhook can map back
    if SUPABASE_URL:
        today = date.today().isoformat()
        async with httpx.AsyncClient() as client:
            await client.post(
                f'{SUPABASE_URL}/rest/v1/standup_responses',
                headers={**supabase_headers(), 'Prefer': 'resolution=merge-duplicates'},
                json={'slack_user_id': user_id, 'date': today, 'status': 'called'},
            )

    # Resolve user name from Slack if not provided
    if not user_name and SLACK_BOT_TOKEN:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(
                    'https://slack.com/api/users.info',
                    headers={'Authorization': f'Bearer {SLACK_BOT_TOKEN}'},
                    params={'user': user_id},
                )
                profile = res.json().get('user', {}).get('profile', {})
                user_name = (
                    profile.get('display_name')
                    or profile.get('real_name')
                    or user_id
                )
        except Exception:
            user_name = user_id

    if not user_name:
        user_name = user_id

    # Fetch personalized context for this user
    context = await get_context_for_member(user_id)

    # Get signed URL from ElevenLabs
    el_headers = {
        'xi-api-key': ELEVENLABS_API_KEY,
    }
    el_params = {
        'agent_id': ELEVENLABS_AGENT_ID,
    }

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f'{ELEVENLABS_BASE_URL}/convai/conversation/get-signed-url',
            headers=el_headers,
            params=el_params,
            timeout=30.0,
        )

    if response.status_code != 200:
        return HTMLResponse(
            f'<h2>ElevenLabs API error ({response.status_code})</h2>',
            status_code=502,
        )

    data = response.json()
    signed_url = data.get('signed_url', '')

    if not signed_url:
        return HTMLResponse('<h2>Could not get signed URL</h2>', status_code=502)

    # Escape strings for safe JS embedding
    import json as _json
    js_signed_url = _json.dumps(signed_url)
    js_user_name = _json.dumps(user_name)
    js_context = _json.dumps(context)

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>StandupBot</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0a0a;
            color: #e0e0e0;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }}
        .container {{ text-align: center; padding: 2rem; }}
        #status {{
            font-size: 1.1rem;
            color: #888;
        }}
        #status.live {{
            color: #00c864;
        }}
        #status.ended {{
            color: #666;
        }}
        #status.error {{
            color: #ff3c3c;
        }}
        .dot {{
            display: inline-block;
            width: 10px; height: 10px;
            border-radius: 50%;
            background: #00c864;
            margin-right: 8px;
            animation: pulse 1.5s infinite;
        }}
        @keyframes pulse {{
            0%, 100% {{ opacity: 1; }}
            50% {{ opacity: 0.3; }}
        }}
        button {{
            margin-top: 1.5rem;
            padding: 0.7rem 1.5rem;
            border-radius: 8px;
            border: none;
            background: #dc2626;
            color: white;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
        }}
        button:hover {{ background: #b91c1c; }}
    </style>
</head>
<body>
    <div class="container">
        <p id="status">Connecting to your standup agent...</p>
        <button id="end-btn" style="display:none" onclick="endCall()">End Call</button>
    </div>
    <script type="module">
        import {{ Conversation }} from 'https://cdn.jsdelivr.net/npm/@11labs/client@latest/+esm';

        const statusEl = document.getElementById('status');
        const endBtn = document.getElementById('end-btn');
        let conversation = null;

        async function start() {{
            try {{
                await navigator.mediaDevices.getUserMedia({{ audio: true }});
                conversation = await Conversation.startSession({{
                    signedUrl: {js_signed_url},
                    dynamicVariables: {{
                        user_name: {js_user_name},
                        custom_context: {js_context},
                    }},
                    onConnect: () => {{
                        statusEl.innerHTML = '<span class="dot"></span>Call in progress';
                        statusEl.className = 'live';
                        endBtn.style.display = 'inline-block';
                    }},
                    onDisconnect: () => {{
                        statusEl.textContent = 'Call ended. You can close this tab.';
                        statusEl.className = 'ended';
                        endBtn.style.display = 'none';
                    }},
                    onError: (err) => {{
                        console.error(err);
                        statusEl.textContent = 'Connection error — please refresh.';
                        statusEl.className = 'error';
                    }},
                }});
            }} catch (err) {{
                console.error(err);
                statusEl.textContent = err.name === 'NotAllowedError'
                    ? 'Microphone access denied. Please allow mic and refresh.'
                    : 'Failed to connect — please refresh.';
                statusEl.className = 'error';
            }}
        }}

        window.endCall = async function() {{
            if (conversation) {{
                await conversation.endSession();
                conversation = null;
            }}
        }};

        start();
    </script>
</body>
</html>'''

    return HTMLResponse(content=html)


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

    # ElevenLabs sends post_call_transcription — unwrap the data envelope
    data = payload.get('data', payload)
    conversation_id = data.get('conversation_id') or payload.get('conversation_id')

    if not conversation_id:
        raise HTTPException(status_code=400, detail='Missing conversation_id in webhook payload')

    # Look up which user started a call today (most recently called)
    today = date.today().isoformat()
    async with httpx.AsyncClient() as client:
        res = await client.get(
            f'{SUPABASE_URL}/rest/v1/standup_responses',
            headers=supabase_headers(),
            params={
                'date': f'eq.{today}',
                'status': 'eq.pending',
                'order': 'created_at.desc',
                'limit': '1',
            },
        )
    rows = res.json()
    if not rows:
        raise HTTPException(status_code=404, detail='No matching standup session found for today')

    user_id = rows[0]['slack_user_id']

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

    # Mark standup as completed in Supabase
    today = date.today().isoformat()
    async with httpx.AsyncClient() as client:
        await client.patch(
            f'{SUPABASE_URL}/rest/v1/standup_responses',
            headers=supabase_headers(),
            params={'date': f'eq.{today}', 'slack_user_id': f'eq.{user_id}'},
            json={'status': 'completed'},
        )

    # Notify the user in Slack that their standup was received
    await send_slack_dm(
        user_id,
        'Your standup has been recorded! Your team lead will see the summary shortly.'
    )

    return {'status': 'ok', 'conversation_id': conversation_id}
