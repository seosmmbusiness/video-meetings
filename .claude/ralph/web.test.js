'use strict';

/**
 * The web view's own suite: `node --test .claude/ralph/web.test.js`.
 *
 * The dashboard's buttons pause, halt and roll back an unattended build, so the page is only ever
 * bound to the loopback and only ever answers a request that carries the run's token. Both of those
 * are cheap to get subtly wrong — a length-only token check, an `Origin` a rebinding attack can set
 * — so they are asserted here rather than eyeballed.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');

const monitor = require('./monitor');
const web = require('./web');

/**
 * Starts the dashboard on a port the operating system picks.
 *
 * @returns {Promise<{ port: number, token: string, server: object }>} The running server.
 */
function listen() {
  return new Promise((resolve, reject) => {
    const token = 'x'.repeat(24);
    const server = web.createServer({ port: 0, token });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.setPort(port);
      resolve({ port, token, server });
    });
  });
}

/**
 * Sends a raw request line, which is how a target `URL` refuses is presented at all.
 *
 * @param {number} port Where the dashboard listens.
 * @param {string} target The request target, verbatim.
 * @returns {Promise<string>} The whole response.
 */
function rawRequest(port, target) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
    });
    let text = '';
    socket.setTimeout(5000, () => {
      socket.destroy();
      resolve(text);
    });
    socket.on('data', (chunk) => {
      text += chunk;
      if (text.includes('\r\n\r\n')) {
        socket.end();
        resolve(text);
      }
    });
    socket.on('error', reject);
    socket.on('close', () => resolve(text));
  });
}

test('tokenOk accepts the run token and nothing else', () => {
  const token = 'a'.repeat(32);
  assert.equal(web.tokenOk(token, token), true);
  assert.equal(web.tokenOk(`${'a'.repeat(31)}b`, token), false);
  assert.equal(web.tokenOk('', token), false);
  assert.equal(web.tokenOk(undefined, token), false);
  assert.equal(web.tokenOk('a'.repeat(64), token), false);
});

test('originOk allows the page talking to itself, and refuses a foreign page', () => {
  assert.equal(web.originOk(undefined, 4599), true, 'curl sends no Origin');
  assert.equal(web.originOk('http://127.0.0.1:4599', 4599), true);
  assert.equal(web.originOk('http://localhost:4599', 4599), true);
  assert.equal(web.originOk('http://127.0.0.1:4600', 4599), false);
  assert.equal(web.originOk('https://evil.example', 4599), false);
  assert.equal(web.originOk('null', 4599), false);
});

test('hostOk refuses a Host header that is not the loopback, which is how rebinding arrives', () => {
  assert.equal(web.hostOk('127.0.0.1:4599'), true);
  assert.equal(web.hostOk('localhost:4599'), true);
  assert.equal(web.hostOk('[::1]:4599'), true);
  assert.equal(web.hostOk('ralph.evil.example:4599'), false);
  assert.equal(web.hostOk(undefined), false);
});

test('escapeHtml neutralises every character that could close a tag or an attribute', () => {
  assert.equal(
    web.escapeHtml('<script>alert("x" & \'y\')</script>'),
    '&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;',
  );
});

test('sseFrame keeps a payload on one data line whatever it contains', () => {
  const frame = web.sseFrame({ text: 'first\nsecond\r\nthird' });
  assert.ok(frame.endsWith('\n\n'));
  const body = frame.slice(0, -2);
  assert.equal(body.split('\n').length, 1, body);
  assert.deepEqual(JSON.parse(body.replace(/^data: /, '')), {
    text: 'first\nsecond\r\nthird',
  });
});

test('the page it serves is self-contained — no request may leave the machine', () => {
  const html = web.renderPage(4599);
  assert.ok(!/src\s*=\s*["']https?:/i.test(html), 'no remote script');
  assert.ok(!/href\s*=\s*["']https?:/i.test(html), 'no remote stylesheet');
  assert.ok(html.includes('<title>'), 'the tab is named');
});

test('the page reads its token from the address bar rather than carrying one baked in', () => {
  const html = web.renderPage(4599);
  assert.ok(html.includes('location.search'), 'token comes from the URL');
  assert.ok(
    !/[0-9a-f]{32}/.test(html),
    'no token is baked into the served page',
  );
});

test('a request target URL refuses is answered, not crashed on', async () => {
  const { port, server } = await listen();
  try {
    const response = await rawRequest(port, '//[::1');
    assert.match(response, /^HTTP\/1\.1 400/, response.slice(0, 80));
    // Still serving: the malformed target must not have taken the process or the socket down.
    const after = await rawRequest(port, '/nothing-here');
    assert.match(after, /^HTTP\/1\.1 40[13]/, after.slice(0, 80));
  } finally {
    server.close();
  }
});

test('an oversized command body is refused with an answer, not a reset', async () => {
  const { port, token, server } = await listen();
  try {
    const response = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/command',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-ralph-token': token,
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify({ command: 'pause', pad: 'x'.repeat(200_000) }));
    });
    assert.equal(response.status, 400);
    assert.match(response.body, /too large/);
  } finally {
    server.close();
  }
});

test('a snapshot that throws becomes an answer, not a dead dashboard', async () => {
  const { port, token, server } = await listen();
  const real = monitor.snapshot;
  monitor.snapshot = () => {
    throw new Error('the MS file is half-written');
  };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/snapshot?token=${token}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.why, /half-written/);
  } finally {
    monitor.snapshot = real;
    server.close();
  }
});
