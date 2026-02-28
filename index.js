require('dotenv').config();
const { App } = require('@slack/bolt');
const { scheduleStandup } = require('./scheduler');
const { registerCommands } = require('./commands');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_LEVEL_TOKEN,
});

registerCommands(app);

(async () => {
  await app.start();
  console.log('StandupBot is running');
  scheduleStandup(app);
})();
