'use strict';

/**
 * The Ralph monitor's web view: one loopback page, a snapshot stream and four buttons.
 *
 * It exists next to the TUI rather than instead of it because the two are good at different things —
 * the terminal view is what runs over ssh, and this one is what a person leaves open on a second
 * screen. Both draw the same `monitor.snapshot()` and call the same commands; nothing decides
 * anything here.
 *
 * What it does decide is who may press the buttons, and that is deliberately narrow: the server
 * binds the loopback only, every request carries the run's token, a cross-origin `Origin` is
 * refused, and a `Host` that is not the loopback is refused too — that last one is what a DNS
 * rebinding attack arrives as, and without it a page open in the same browser could halt a build.
 */

const crypto = require('node:crypto');
const http = require('node:http');

const monitor = require('./monitor');

/** The most a command body may be; nothing this page sends comes near it. */
const MAX_BODY = 64 * 1024;

/** How often a connected page is sent a fresh snapshot. */
const TICK_MS = 1000;

/**
 * Escapes text for HTML. The page builds its DOM with `textContent` and needs this only for the
 * shell it serves, but a single unescaped interpolation is all an injection needs, so it is here and
 * it is covered.
 *
 * @param {*} value What to escape.
 * @returns {string} The text, safe to place in markup or an attribute.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Compares a presented token with the run's, in constant time and without leaking its length.
 *
 * @param {string|undefined} presented What the request carried.
 * @param {string} expected The run's token.
 * @returns {boolean} True when they match.
 */
function tokenOk(presented, expected) {
  if (typeof presented !== 'string' || !presented) return false;
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Whether a request's `Origin` is this page talking to itself.
 *
 * @param {string|undefined} origin The `Origin` header, absent for a non-browser client.
 * @param {number} port The port the server listens on.
 * @returns {boolean} True when the origin is ours, or when there is none.
 */
function originOk(origin, port) {
  if (origin === undefined || origin === null || origin === '') return true;
  return (
    origin === `http://127.0.0.1:${port}` ||
    origin === `http://localhost:${port}` ||
    origin === `http://[::1]:${port}`
  );
}

/**
 * Whether a request's `Host` is the loopback. A hostname that resolves here but is not the loopback
 * is how DNS rebinding reaches a local server, and it is refused.
 *
 * @param {string|undefined} host The `Host` header.
 * @returns {boolean} True when the host is a loopback literal.
 */
function hostOk(host) {
  if (!host) return false;
  const name = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.split(':')[0];
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
}

/**
 * One server-sent-events frame. `JSON.stringify` is what keeps a payload on a single `data:` line,
 * whatever newlines the log it came from contains.
 *
 * @param {*} data The payload.
 * @returns {string} The frame, terminated by the blank line SSE needs.
 */
function sseFrame(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * The page itself — one file, no request leaving the machine, and no token baked in: the page reads
 * its own from the address bar, so the served HTML is worth nothing on its own.
 *
 * @param {number} port The port the server listens on, used for nothing but the title.
 * @returns {string} The whole document.
 */
function renderPage(port) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Ralph · ${escapeHtml(port)}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #0f1115; --panel: #171a21; --line: #262b36; --text: #e6e9ef;
    --muted: #8b93a7; --accent: #7aa2f7; --ok: #7fd88f; --warn: #e0af68; --bad: #f7768e;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg: #f5f6f8; --panel: #fff; --line: #e2e5ea; --text: #1c2029;
            --muted: #5c6478; --accent: #2f5fd0; --ok: #2f8f4e; --warn: #9a6b12; --bad: #c0392f; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 20px; }
  h1 { font-size: 16px; margin: 0; letter-spacing: .04em; }
  .wrap { max-width: 980px; margin: 0 auto; display: grid; gap: 14px; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
  .row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
  .pill { border-radius: 999px; padding: 2px 10px; font-size: 12px; border: 1px solid var(--line); }
  .pill.run { color: var(--ok); border-color: var(--ok); }
  .pill.pause { color: var(--warn); border-color: var(--warn); }
  .pill.halt { color: var(--bad); border-color: var(--bad); }
  .bar { height: 10px; border-radius: 999px; background: var(--line); overflow: hidden; margin: 10px 0 6px; }
  .bar > i { display: block; height: 100%; background: var(--accent); width: 0; transition: width .3s; }
  .muted { color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px 16px; }
  .k { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
  .v { font-size: 15px; overflow-wrap: anywhere; }
  #activity { display: grid; gap: 6px; min-height: 66px; }
  #activity div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line);
           border-radius: 8px; padding: 7px 14px; cursor: pointer; }
  button:hover { border-color: var(--accent); }
  button.bad { color: var(--bad); }
  button[disabled] { opacity: .45; cursor: not-allowed; }
  input, select { font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line);
                  border-radius: 6px; padding: 5px 7px; width: 100%; }
  label { display: grid; gap: 4px; font-size: 12px; color: var(--muted); }
  dialog { background: var(--panel); color: var(--text); border: 1px solid var(--line);
           border-radius: 10px; padding: 18px; max-width: 560px; }
  dialog::backdrop { background: rgba(0,0,0,.55); }
  .modes { display: grid; gap: 8px; margin: 12px 0; }
  .mode { text-align: left; display: grid; gap: 3px; }
  .mode b { font-weight: 600; }
  ul { margin: 0; padding-left: 18px; }
  li { color: var(--muted); }
  #flash { min-height: 18px; font-size: 13px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="panel">
    <div class="row">
      <h1 id="feature">Ralph</h1>
      <span class="pill" id="status">connecting…</span>
    </div>
    <div class="bar"><i id="bar"></i></div>
    <div class="row"><span id="phase" class="muted"></span><span id="clock" class="muted"></span></div>
  </div>

  <div class="panel">
    <div class="k">now</div>
    <div id="activity"></div>
  </div>

  <div class="panel">
    <div class="row">
      <div style="display:flex; gap:8px; flex-wrap:wrap">
        <button id="pause">Pause</button>
        <button id="stop" class="bad">Stop</button>
        <button id="rollback" class="bad">Rollback…</button>
      </div>
      <label style="display:flex; gap:6px; align-items:center; color:var(--muted)">
        <input type="checkbox" id="kill" style="width:auto"> kill the session on stop
      </label>
    </div>
    <div id="flash" class="muted"></div>
  </div>

  <div class="panel">
    <div class="grid" id="meta"></div>
  </div>

  <div class="panel">
    <div class="k" style="margin-bottom:10px">settings — applied to the next link</div>
    <div class="grid">
      <label>model <input id="s-model" placeholder="opus"></label>
      <label>fallback <input id="s-fallbackModel" placeholder="sonnet"></label>
      <label>effort
        <select id="s-effort">
          <option value="">inherit</option>
          <option>low</option><option>medium</option><option>high</option>
          <option>xhigh</option><option>max</option>
        </select>
      </label>
      <label>turns / task <input id="s-maxTurnsPerTask" inputmode="numeric"></label>
      <label>turns / bookend <input id="s-maxTurnsPerBookend" inputmode="numeric"></label>
      <label>budget $ / session <input id="s-maxBudgetUsdPerSession" inputmode="decimal"></label>
      <label>retries <input id="s-taskRetries" inputmode="numeric"></label>
      <label>workers <input id="s-workers" disabled title="the chain runs one link at a time"></label>
    </div>
    <div style="margin-top:12px"><button id="save">Save settings</button></div>
  </div>

  <div class="panel">
    <div class="k" style="margin-bottom:8px">events</div>
    <ul id="events"></ul>
  </div>
</div>

<dialog id="rollback-dialog">
  <b>Roll back</b>
  <div class="muted" id="rollback-context"></div>
  <div class="modes" id="rollback-modes"></div>
  <label style="display:flex; gap:6px; align-items:center">
    <input type="checkbox" id="clean" style="width:auto"> also delete untracked files
  </label>
  <div style="margin-top:14px; display:flex; gap:8px; justify-content:flex-end">
    <button id="rollback-cancel">Cancel</button>
  </div>
</dialog>

<script>
(() => {
  const token = new URLSearchParams(location.search).get('token') || '';
  const $ = (id) => document.getElementById(id);
  let snap = null;

  const fmt = {
    duration(ms) {
      const t = Math.max(0, Math.round((ms || 0) / 1000));
      const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
      if (h) return h + 'h ' + String(m).padStart(2, '0') + 'm';
      if (m) return m + 'm ' + String(s).padStart(2, '0') + 's';
      return s + 's';
    },
    money(v) { return typeof v === 'number' ? '$' + v.toFixed(2) : '—'; },
  };

  async function command(body) {
    $('flash').textContent = '…';
    try {
      const res = await fetch('/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ralph-token': token },
        body: JSON.stringify(body),
      });
      const out = await res.json();
      $('flash').textContent = out.why || (out.ok ? 'done' : 'refused');
      $('flash').style.color = out.ok ? '' : 'var(--bad)';
    } catch (err) {
      $('flash').textContent = String(err);
      $('flash').style.color = 'var(--bad)';
    }
  }

  function setText(id, text) { $(id).textContent = text; }

  function renderMeta(s) {
    const link = s.link || {};
    const stream = s.stream || {};
    const pairs = [
      ['stage', s.stage || '—'],
      ['issue', s.currentIssue ? '#' + s.currentIssue : '—'],
      ['branch', s.branch || s.baseBranch || '—'],
      ['model', (link.model || s.settings.model) + (s.settings.model !== link.model && link.model ? ' → ' + s.settings.model : '')],
      ['effort', link.effort || s.settings.effort || 'inherit'],
      ['workers', s.workers.active + ' / ' + s.workers.limit],
      ['sessions', s.sessions + (s.ceilings.sessions ? ' / ' + s.ceilings.sessions : '')],
      ['turns', stream.turns != null ? String(stream.turns) : '—'],
      ['cost (run)', fmt.money(s.cost.run)],
      ['link', link.label ? link.label + (link.alive ? ' · live' : ' · ended') : '—'],
      ['checks', s.checks ? (s.checks.green ? 'green · phase ' + s.checks.phase : 'red · ' + s.checks.failing) : '—'],
    ];
    const meta = $('meta');
    meta.textContent = '';
    for (const [k, v] of pairs) {
      const cell = document.createElement('div');
      const key = document.createElement('div');
      key.className = 'k'; key.textContent = k;
      const val = document.createElement('div');
      val.className = 'v'; val.textContent = v;
      cell.append(key, val);
      meta.append(cell);
    }
  }

  function renderSettings(s) {
    for (const key of ['model', 'fallbackModel', 'effort', 'maxTurnsPerTask',
                       'maxTurnsPerBookend', 'maxBudgetUsdPerSession', 'taskRetries']) {
      const el = $('s-' + key);
      if (el && document.activeElement !== el) el.value = s.settings[key] ?? '';
    }
    $('s-workers').value = s.workers.limit + ' (serial chain)';
  }

  function render(s) {
    snap = s;
    if (!s.ok) {
      setText('status', 'no run');
      $('status').className = 'pill halt';
      setText('phase', s.why || '');
      return;
    }
    setText('feature', 'Ralph · ' + s.feature + ' · run ' + s.runId);
    const state = s.stopped ? 'halted' : s.paused ? 'paused' : s.link && s.link.alive ? 'running' : 'idle';
    setText('status', state + (s.halt ? ' · ' + s.halt : ''));
    $('status').className = 'pill ' + (s.stopped ? 'halt' : s.paused ? 'pause' : 'run');
    $('pause').textContent = s.paused || s.stopped ? 'Resume' : 'Pause';

    const p = s.progress;
    const done = p.phaseNumber ? p.phaseNumber - 1 : s.phases.length;
    const within = p.taskTotal ? (p.taskNumber || 0) / p.taskTotal : 0;
    $('bar').style.width = Math.min(100, ((done + within) / Math.max(1, p.phaseTotal)) * 100) + '%';
    setText('phase', p.phaseNumber
      ? 'phase ' + p.phaseNumber + '/' + p.phaseTotal + ' · ' + (p.title || '') +
        (p.taskNumber ? ' · task ' + p.taskNumber + '/' + p.taskTotal + (p.taskId ? ' (' + p.taskId + ')' : '') : '')
      : 'every phase has settled');
    setText('clock', fmt.duration(s.elapsedMs) + (s.link && s.link.alive ? ' · link ' + fmt.duration(s.link.elapsedMs) : ''));

    const activity = $('activity');
    activity.textContent = '';
    const lines = s.activity.length ? s.activity : ['—'];
    for (const line of lines) {
      const div = document.createElement('div');
      div.textContent = line;
      activity.append(div);
    }
    if (s.stream && s.stream.thinking) {
      const div = document.createElement('div');
      div.className = 'muted';
      div.textContent = 'thinking ~' + s.stream.thinking + ' tokens';
      activity.append(div);
    }

    renderMeta(s);
    renderSettings(s);

    const events = $('events');
    events.textContent = '';
    for (const e of [...s.events].reverse()) {
      const li = document.createElement('li');
      li.textContent = e.at.slice(11, 19) + ' · ' + e.type + (e.why ? ' · ' + e.why : '');
      events.append(li);
    }
  }

  $('pause').onclick = () => command({ command: snap && (snap.paused || snap.stopped) ? 'resume' : 'pause' });
  $('stop').onclick = () => {
    if (!confirm('Halt the run' + ($('kill').checked ? ' and kill the session in flight' : '') + '?')) return;
    command({ command: 'stop', kill: $('kill').checked });
  };
  $('rollback').onclick = () => {
    const dialog = $('rollback-dialog');
    const holder = $('rollback-modes');
    holder.textContent = '';
    setText('rollback-context', snap && snap.lastMerge
      ? 'last merge: PR #' + snap.lastMerge.pr + ' (phase ' + snap.lastMerge.phase + ')'
      : 'this run has merged nothing yet');
    for (const mode of (snap && snap.rollbackModes) || []) {
      const button = document.createElement('button');
      button.className = 'mode bad';
      const title = document.createElement('b');
      title.textContent = mode.title;
      const detail = document.createElement('span');
      detail.className = 'muted';
      detail.textContent = mode.detail;
      button.append(title, detail);
      button.onclick = () => {
        if (!confirm(mode.title + '\\n\\n' + mode.detail + '\\n\\nProceed?')) return;
        dialog.close();
        command({ command: 'rollback', mode: mode.key, clean: $('clean').checked });
      };
      holder.append(button);
    }
    dialog.showModal();
  };
  $('rollback-cancel').onclick = () => $('rollback-dialog').close();
  $('save').onclick = () => {
    const patch = {};
    for (const key of ['model', 'fallbackModel', 'effort', 'maxTurnsPerTask',
                       'maxTurnsPerBookend', 'maxBudgetUsdPerSession', 'taskRetries']) {
      patch[key] = $('s-' + key).value;
    }
    command({ command: 'settings', patch });
  };

  const stream = new EventSource('/events?token=' + encodeURIComponent(token));
  stream.onmessage = (event) => render(JSON.parse(event.data));
  stream.onerror = () => { $('status').textContent = 'disconnected'; $('status').className = 'pill halt'; };
})();
</script>
</body>
</html>
`;
}

/**
 * Reads a request's JSON body, refusing anything larger than a command could be.
 *
 * @param {import('node:http').IncomingMessage} req The request.
 * @returns {Promise<object>} The parsed body, or an empty object.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        // Paused, not destroyed: destroying the socket here races the 400 the handler is about to
        // write, and the client sees a reset instead of being told what was wrong.
        req.pause();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Runs one command from the page against the monitor core.
 *
 * @param {object} body The parsed command body.
 * @returns {object} What the core answered.
 */
function runCommand(body) {
  switch (body && body.command) {
    case 'pause':
      return monitor.pause();
    case 'resume':
      return monitor.resume();
    case 'stop':
      return monitor.stop({ kill: Boolean(body.kill) });
    case 'rollback':
      return monitor.rollback(String(body.mode || ''), {
        clean: Boolean(body.clean),
      });
    case 'settings':
      return monitor.applySettings(body.patch || {});
    default:
      return { ok: false, why: `unknown command ${body && body.command}` };
  }
}

/**
 * The snapshot the page draws, with the rollback menu folded in so the client invents nothing.
 *
 * @returns {object} The snapshot.
 */
function payload() {
  return { ...monitor.snapshot(), rollbackModes: monitor.ROLLBACK_MODES };
}

/**
 * The payload, serialised, with a failure turned into a snapshot that says so.
 *
 * A snapshot reads files the run owns — a truncated MS file or a state file mid-write can throw, and
 * a throw inside this server's async handler would end the process rather than the request.
 *
 * @param {object} [opts] `{ raw }` for plain JSON instead of an SSE frame.
 * @returns {string} The frame, or the JSON body.
 */
function safePayload(opts = {}) {
  let body;
  try {
    body = payload();
  } catch (err) {
    body = { ok: false, why: `snapshot failed: ${err.message}` };
  }
  return opts.raw ? JSON.stringify(body) : sseFrame(body);
}

/**
 * Builds the server. It is created rather than started here so a suite can drive it without opening
 * a port.
 *
 * @param {object} opts `{ port, token }`.
 * @returns {import('node:http').Server} The server.
 */
function createServer(opts) {
  const { token } = opts;
  // The port is mutable because `start()` may ask for 0 and learn the real one only once the socket
  // is listening — and both the origin check and the page's own URL need the real one.
  let port = Number(opts.port ?? 0);
  const clients = new Set();

  const server = http.createServer(async (req, res) => {
    // A request target node's parser accepts but `URL` refuses (`//[::1`, say) would throw here,
    // inside an async handler nothing observes — which ends the process, and with it the view.
    let url;
    try {
      url = new URL(req.url, `http://127.0.0.1:${port}`);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end('bad request target\n');
      return;
    }
    const presented =
      req.headers['x-ralph-token'] || url.searchParams.get('token');

    if (!hostOk(req.headers.host)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('this dashboard answers on the loopback only\n');
      return;
    }
    if (!originOk(req.headers.origin, port)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('cross-origin requests are refused\n');
      return;
    }
    if (!tokenOk(presented, token)) {
      res.writeHead(401, { 'content-type': 'text/plain' });
      res.end('this dashboard needs the run token printed when it started\n');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
      });
      res.end(renderPage(port));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(safePayload());
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/snapshot') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(safePayload({ raw: true }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/command') {
      let body;
      try {
        body = await readBody(req);
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, why: err.message }));
        return;
      }
      let result;
      try {
        result = runCommand(body);
      } catch (err) {
        result = { ok: false, why: err.message };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
  });

  const tick = setInterval(() => {
    if (!clients.size) return;
    const frame = safePayload();
    for (const client of clients) {
      // A page whose socket has stopped draining gets skipped rather than buffered into memory; the
      // next tick is a second away and carries the whole state anyway.
      if (client.writableLength > 1024 * 1024) continue;
      client.write(frame);
    }
  }, TICK_MS);
  tick.unref();

  server.on('close', () => {
    clearInterval(tick);
    for (const client of clients) client.end();
    clients.clear();
  });

  /**
   * Tells the server which port it actually got, when it was asked to take any free one.
   *
   * @param {number} actual The listening port.
   * @returns {void}
   */
  server.setPort = (actual) => {
    port = Number(actual);
  };

  return server;
}

/**
 * Starts the dashboard on the loopback.
 *
 * @param {object} [opts] `{ port }` — 0 lets the operating system choose.
 * @returns {Promise<{ url: string, port: number, token: string, server: object }>} Where it listens.
 */
function start(opts = {}) {
  const token = crypto.randomBytes(24).toString('base64url');
  const wanted = Number(opts.port ?? 4599);
  return new Promise((resolve, reject) => {
    const server = createServer({ port: wanted, token });
    server.on('error', reject);
    server.listen(wanted, '127.0.0.1', () => {
      const port = server.address().port;
      server.setPort(port);
      resolve({
        url: `http://127.0.0.1:${port}/?token=${token}`,
        port,
        token,
        server,
      });
    });
  });
}

module.exports = {
  createServer,
  escapeHtml,
  hostOk,
  originOk,
  renderPage,
  runCommand,
  sseFrame,
  start,
  tokenOk,
};
