const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'store.json');

const defaults = {
  members: [],        // array of Slack user IDs
  standupTime: '09:30',  // 24h format HH:MM
  standupChannel: null,  // Slack channel ID for summaries
  customQuestions: {},   // { slackUserId: ["question1", "question2"] }
};

function load() {
  if (!fs.existsSync(STORE_PATH)) return { ...defaults };
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

function save(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function getStore() {
  return load();
}

function setMembers(members) {
  const store = load();
  store.members = members;
  save(store);
}

function setStandupTime(time) {
  const store = load();
  store.standupTime = time;
  save(store);
}

function setStandupChannel(channelId) {
  const store = load();
  store.standupChannel = channelId;
  save(store);
}

function addCustomQuestion(userId, question) {
  const store = load();
  if (!store.customQuestions[userId]) store.customQuestions[userId] = [];
  store.customQuestions[userId].push(question);
  save(store);
}

function clearCustomQuestions(userId) {
  const store = load();
  store.customQuestions[userId] = [];
  save(store);
}

module.exports = {
  getStore,
  setMembers,
  setStandupTime,
  setStandupChannel,
  addCustomQuestion,
  clearCustomQuestions,
};