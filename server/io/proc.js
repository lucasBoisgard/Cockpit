const fs = require('node:fs');

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function claudeLockAlive({ pid, start }) {
  try {
    return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19] === start;
  } catch {
    return false;
  }
}

function procRead(pid, file) {
  try {
    return fs.readFileSync(`/proc/${pid}/${file}`, 'utf8');
  } catch {
    return null;
  }
}

function procCwd(pid) {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

function listeningPortsBySocket() {
  const ports = new Map();
  for (const file of ['tcp', 'tcp6']) {
    for (const line of (procRead('net', file) || '').split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols[3] === '0A') ports.set(cols[9], parseInt(cols[1].split(':')[1], 16));
    }
  }
  return ports;
}

function processPorts(pid, listening) {
  let fds = [];
  try {
    fds = fs.readdirSync(`/proc/${pid}/fd`);
  } catch {
    return [];
  }
  const ports = new Set();
  for (const fd of fds) {
    try {
      const inode = /^socket:\[(\d+)\]$/.exec(fs.readlinkSync(`/proc/${pid}/fd/${fd}`))?.[1];
      if (inode && listening.has(inode)) ports.add(listening.get(inode));
    } catch {}
  }
  return [...ports];
}

module.exports = { processAlive, claudeLockAlive, procRead, procCwd, listeningPortsBySocket, processPorts };
