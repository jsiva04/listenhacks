const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const { getStore } = require('./store');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

let currentJob = null;

// Called once on startup — reads store and schedules the cron
async function scheduleStandup(app) {
  const store = await getStore();
  startJob(app, store.standupTime);
}

function startJob(app, time) {
  if (currentJob) currentJob.stop();

  const [hour, minute] = time.split(':');
  const expression = `${minute} ${hour} * * 1-5`; // weekdays only

  currentJob = cron.schedule(expression, () => triggerStandup(app));
  console.log(`Standup scheduled at ${time} (weekdays)`);
}

async function triggerStandup(app) {
  const store = await getStore();

  if (!store.members.length) {
    console.log('No standup members configured, skipping');
    return;
  }

  console.log(`Triggering standup for ${store.members.length} member(s)`);

  for (const userId of store.members) {
    await dmMember(app, userId, store.customQuestions[userId] || []);
  }
}

async function dmMember(app, userId, customQuestions) {
  console.log(`[dmMember] sending to ${userId}`);
  try {
    const dm = await app.client.conversations.open({ users: userId });
    const channelId = dm.channel.id;

    const elevenLabsUrl = process.env.ELEVENLABS_CALL_URL;
    if (!elevenLabsUrl) {
      console.error('ELEVENLABS_CALL_URL not set in .env');
      return;
    }

    // Look up the user's real name from Slack
    let userName = userId; // fallback to ID
    try {
      const userInfo = await app.client.users.info({ user: userId });
      userName =
        userInfo.user.profile.display_name ||
        userInfo.user.real_name ||
        userInfo.user.name ||
        userId;
    } catch (e) {
      console.warn(`Could not resolve name for ${userId}, using ID as fallback`);
    }

    // Append user_id and user_name so ElevenLabs can use them as dynamic variables
    const callUrl = `${elevenLabsUrl}&user_id=${userId}&user_name=${encodeURIComponent(userName)}`;

    // Pre-insert a pending row so the webhook can match this user later
    const today = new Date().toISOString().split('T')[0];
    await supabase
      .from('standup_responses')
      .upsert({ slack_user_id: userId, date: today, status: 'pending' }, { onConflict: 'date,slack_user_id' });

    const questionLines = customQuestions.length
      ? `\nYour standup leader also has some specific questions for you today.`
      : '';

    await app.client.chat.postMessage({
      channel: channelId,
      text: `Hey <@${userId}>! Time for your daily standup.${questionLines}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Hey <@${userId}>! Time for your daily standup. 🎙️${questionLines}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Join Standup Call' },
              url: callUrl,
              style: 'primary',
            },
          ],
        },
      ],
    });

    console.log(`DM sent to ${userId} — call URL: ${callUrl}`);
  } catch (err) {
    console.error(`Failed to DM ${userId}:`, err.message, err.data);
  }
}

async function postSummary(app, summaries) {
  const store = await getStore();
  if (!store.standupChannel) {
    console.warn('No standup channel set — summary not posted');
    return;
  }

  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Standup Summary — ${date}` },
    },
    { type: 'divider' },
  ];

  for (const { userId, yesterday, today, blockers } of summaries) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*<@${userId}>*\n` +
          `*Yesterday:* ${yesterday}\n` +
          `*Today:* ${today}\n` +
          `*Blockers:* ${blockers || 'None'} ${blockers ? '⚠️' : '✅'}`,
      },
    });
    blocks.push({ type: 'divider' });
  }

  await app.client.chat.postMessage({
    channel: store.standupChannel,
    blocks,
    text: `Standup Summary — ${date}`,
  });
}

module.exports = { scheduleStandup, triggerStandup, postSummary };
