const { execFile, execFileSync } = require('node:child_process');

function run(cmd, args, input) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) =>
      resolve({ ok: !error, stdout: stdout || '', stderr: stderr || (error ? error.message : '') }),
    );
    if (input !== undefined) child.stdin.end(input);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tmux = (args, input) => run('tmux', args, input);

async function git(cwd, args) {
  const result = await run('git', ['-C', cwd, ...args]);
  return result.ok ? result.stdout : null;
}

const ghAvailable = (() => {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function gh(cwd, args) {
  return new Promise((resolve) => {
    execFile('gh', args, { cwd, maxBuffer: 20 * 1024 * 1024, timeout: 30000 }, (error, stdout, stderr) => resolve({ ok: !error, stdout: stdout || '', stderr: stderr || (error ? error.message : '') }));
  });
}

module.exports = { run, sleep, tmux, git, ghAvailable, gh };
