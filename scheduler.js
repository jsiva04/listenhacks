const cron = require('node-cron');
const { getStore } = require('./store');

let currentJob = null;

// Called once on startup — reads store and schedules the cron
function scheduleStandup(app) {
  const store = getStore();
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
  const store = getStore();

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
  try {
    // Open a DM channel with the user
    const dm = await app.client.conversations.open({ users: userId });
    const channelId = dm.channel.id;

    // TODO: Person 2 will replace this message with an ElevenLabs call link
    const callUrl = `https://placeholder-elevenlabs-call.io/${userId}`;

    const questionLines = customQuestions.length
      ? `\nYour standup leader also has some specific questions for you today.`
      : '';

    await app.client.chat.postMessage({
      channel: channelId,
      text: `Hey <@${userId}>! Time for your daily standup. 🎙️${questionLines}\n\n<${callUrl}|Click here to join your voice standup>`,
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

    console.log(`DM sent to ${userId}`);
  } catch (err) {
    console.error(`Failed to DM ${userId}:`, err.message);
  }
}

async function postSummary(app, summaries) {
  const store = getStore();
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
