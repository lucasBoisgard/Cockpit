const { PORT, HOST, REPO, TICK_ENABLED } = require('./config');
const { createServer } = require('./http');
const { startTicking } = require('./features/tick');

createServer().listen(PORT, HOST, () => {
  console.log(`Worktree dashboard on http://${HOST}:${PORT} (repo ${REPO})`);
  if (TICK_ENABLED) startTicking();
});
