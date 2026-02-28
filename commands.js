const {
  setMembers,
  setStandupTime,
  setStandupChannel,
  addCustomQuestion,
  clearCustomQuestions,
  getStore,
} = require('./store');
const { triggerStandup } = require('./scheduler');

function registerCommands(app) {
  app.command('/standup', async ({ command, ack, respond }) => {
    await ack();

    const args = command.text.trim().split(/\s+/);
    const sub = args[0];

    // /standup config time 09:30
    if (sub === 'config' && args[1] === 'time') {
      const time = args[2];
      if (!time || !/^\d{2}:\d{2}$/.test(time)) {
        return respond('Usage: `/standup config time HH:MM` (24h format, e.g. `09:30`)');
      }
      setStandupTime(time);
      return respond(`Standup time set to *${time}*`);
    }

    // /standup config channel
    if (sub === 'config' && args[1] === 'channel') {
      setStandupChannel(command.channel_id);
      return respond(`Standup summaries will be posted to this channel`);
    }

    // /standup config members @user1 @user2 ...
    if (sub === 'config' && args[1] === 'members') {
      const rawMentions = args.slice(2);
      if (!rawMentions.length) {
        return respond('Usage: `/standup config members @user1 @user2 ...`');
      }
      const members = await resolveUserIds(app.client, rawMentions);
      if (!members.length) {
        return respond('Could not resolve any users. Make sure to @mention them by selecting from the dropdown.');
      }
      setMembers(members);
      return respond(`Standup members set: ${members.map(id => `<@${id}>`).join(', ')}`);
    }

    // /standup ask @user What is blocking you this week?
    if (sub === 'ask') {
      const [userId] = await resolveUserIds(app.client, [args[1]]);
      const question = args.slice(2).join(' ');
      if (!userId || !question) {
        return respond('Usage: `/standup ask @user Your question here`');
      }
      addCustomQuestion(userId, question);
      return respond(`Custom question added for <@${userId}>: _"${question}"_`);
    }

    // /standup clear @user
    if (sub === 'clear') {
      const [userId] = await resolveUserIds(app.client, [args[1]]);
      if (!userId) return respond('Usage: `/standup clear @user`');
      clearCustomQuestions(userId);
      return respond(`Custom questions cleared for <@${userId}>`);
    }

    // /standup status
    if (sub === 'status') {
      const store = getStore();
      const members = store.members.map(id => `<@${id}>`).join(', ') || 'none';
      return respond(
        `*Standup Config*\n` +
        `Time: *${store.standupTime}*\n` +
        `Members: ${members}\n` +
        `Summary channel: ${store.standupChannel ? `<#${store.standupChannel}>` : 'not set (use /standup config channel)'}`
      );
    }

    // /standup run  — trigger immediately
    if (sub === 'run') {
      const store = getStore();
      if (!store.members.length) return respond('No members configured. Use `/standup config members @user1 @user2`');
      respond('Starting standup now...');
      triggerStandup(app);
      return;
    }

    // fallback: help
    return respond(
      '*StandupBot Commands*\n' +
      '`/standup config time HH:MM` — set daily standup time\n' +
      '`/standup config channel` — set summary channel to this channel\n' +
      '`/standup config members @u1 @u2` — set standup members\n' +
      '`/standup ask @user Question` — add custom question for a member\n' +
      '`/standup clear @user` — remove custom questions for a member\n' +
      '`/standup status` — view current config\n' +
      '`/standup run` — trigger standup immediately'
    );
  });
}

// Resolves an array of mentions (e.g. "<@U123>", "@janahan", "janahan")
// to Slack user IDs, with a username lookup fallback
async function resolveUserIds(client, mentions) {
  const results = [];
  let userList = null;

  for (const mention of mentions) {
    if (!mention) continue;

    // Try resolved mention format first: <@U12345> or <@U12345|name>
    const match = mention.match(/^<@([A-Z0-9]+)(?:\|[^>]+)?>$/);
    if (match) {
      results.push(match[1]);
      continue;
    }

    // Fallback: look up by display name or username via users.list
    if (!userList) {
      const res = await client.users.list({});
      userList = res.members.filter(m => !m.is_bot && !m.deleted);
    }

    const name = mention.replace(/^@/, '').toLowerCase();
    const found = userList.find(
      m =>
        m.name?.toLowerCase() === name ||
        m.profile?.display_name?.toLowerCase() === name ||
        m.real_name?.toLowerCase() === name
    );

    if (found) results.push(found.id);
  }

  return results;
}

module.exports = { registerCommands };
