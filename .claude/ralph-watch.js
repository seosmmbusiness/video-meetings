'use strict';

/**
 * Attaches a view to a Ralph run that is already going.
 *
 * The loop is a chain of detached processes: nothing about watching it is coupled to starting it, so
 * a view can be opened, closed and opened again — from another terminal, or from a browser — while
 * the build carries on. Closing a view never touches the run.
 *
 * Usage:
 *   node .claude/ralph-watch.js                    the terminal view
 *   node .claude/ralph-watch.js --ui               the terminal view, plus a dashboard on 127.0.0.1
 *   node .claude/ralph-watch.js --ui --port 4600   the dashboard on a port of your choosing
 *   node .claude/ralph-watch.js --ui --no-tui      the dashboard only, for a terminal that is busy
 *
 * `ralph-start.js --watch` / `--ui` call `attach()` here rather than re-implementing any of it.
 */

/**
 * Opens whichever views were asked for.
 *
 * @param {object} [opts] `{ ui, port, noTui }`.
 * @returns {Promise<{ url: string|null }>} The dashboard's address, when one was started.
 * @throws {Error} When the dashboard's port cannot be taken.
 */
async function attach(opts = {}) {
  let url = null;

  if (opts.ui) {
    const web = require('./ralph/web');
    const started = await web.start({ port: Number(opts.port ?? 4599) });
    url = started.url;
    process.stdout.write(
      `Ralph dashboard: ${url}\n` +
        '  The token is part of that address — anyone holding it can pause, halt and roll this run back.\n',
    );
    if (opts.noTui) return { url };
  }

  if (!process.stdout.isTTY) {
    if (url) return { url };
    throw new Error(
      'not a terminal — pass --ui --no-tui to run the dashboard on its own',
    );
  }

  require('./ralph/tui').run({ url });
  return { url };
}

module.exports = { attach };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--port');
  attach({
    ui: argv.includes('--ui'),
    noTui: argv.includes('--no-tui'),
    port: at === -1 ? undefined : argv[at + 1],
  }).catch((err) => {
    process.stdout.write(`Ralph watch failed: ${err.message}\n`);
    process.exitCode = 1;
  });
}
