function parseJson(text, fallback) { try { return JSON.parse(text) ?? fallback; } catch { return fallback; } }
function localGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function localSet(key, value) { try { localStorage.setItem(key, value); } catch {} }
const $ = (id) => document.getElementById(id);

const urlToken = new URLSearchParams(location.search).get('token');
if (urlToken) { localSet('token', urlToken); history.replaceState(null, '', location.pathname); }
const token = urlToken || localGet('token') || '';

function api(url, options = {}) {
  return fetch(url, { ...options, headers: { ...(options.headers || {}), 'X-Cockpit-Token': token } });
}

async function post(url, body) {
  try {
    const res = await api(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cockpit': '1' }, body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'Serveur injoignable.' } };
  }
}

function setHtml(el, html) {
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}
