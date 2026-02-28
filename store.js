const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function getStore() {
  const [{ data: config }, { data: members }, { data: questions }] = await Promise.all([
    supabase.from('config').select('*').eq('id', 1).single(),
    supabase.from('members').select('slack_user_id'),
    supabase.from('custom_questions').select('*'),
  ]);

  const customQuestions = {};
  for (const row of questions || []) {
    if (!customQuestions[row.slack_user_id]) customQuestions[row.slack_user_id] = [];
    customQuestions[row.slack_user_id].push(row.question);
  }

  return {
    standupTime: config?.standup_time || '09:30',
    standupChannel: config?.standup_channel || null,
    members: (members || []).map(m => m.slack_user_id),
    customQuestions,
  };
}

async function setStandupTime(time) {
  await supabase.from('config').update({ standup_time: time }).eq('id', 1);
}

async function setStandupChannel(channelId) {
  await supabase.from('config').update({ standup_channel: channelId }).eq('id', 1);
}

async function setMembers(userIds) {
  await supabase.from('members').delete().neq('slack_user_id', '');
  if (userIds.length) {
    await supabase.from('members').insert(userIds.map(id => ({ slack_user_id: id })));
  }
}

async function addCustomQuestion(userId, question) {
  await supabase.from('custom_questions').insert({ slack_user_id: userId, question });
}

async function clearCustomQuestions(userId) {
  await supabase.from('custom_questions').delete().eq('slack_user_id', userId);
}

module.exports = {
  getStore,
  setMembers,
  setStandupTime,
  setStandupChannel,
  addCustomQuestion,
  clearCustomQuestions,
};
