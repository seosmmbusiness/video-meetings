'use strict';

/**
 * The Ralph monitor's terminal view.
 *
 * Zero dependencies and one screen: the run's progress, what the link in flight is doing right now,
 * the settings the next link will be spawned with, and the keys that change any of it. It draws
 * `monitor.snapshot()` and calls the monitor's commands — it decides nothing itself, which is what
 * keeps it interchangeable with the web view.
 *
 * Two details are deliberate. Everything it prints goes through `sanitise()`, because the activity
 * lines come out of a log a session wrote, and a terminal that renders an escape sequence out of a
 * log is a terminal a log can drive. And every destructive key asks first, in a modal that names
 * exactly what it is about to do — a rollback resets branches, and a keystroke away from that is too
 * close.
 */

const monitor = require('./monitor');

/** How often the screen is redrawn. Fast enough to feel live, cheap because a snapshot reads files. */
const TICK_MS = 500;

/** The widest the panel is drawn, however wide the terminal is. */
const MAX_WIDTH = 110;

/** ANSI helpers, switched off wholesale when the terminal or `NO_COLOR` says so. */
const colour = {
  on: process.stdout.isTTY && !process.env.NO_COLOR,
  /**
   * Wraps text in an SGR code.
   *
   * @param {string} code The SGR parameters.
   * @param {string} text The text.
   * @returns {string} The text, coloured when colour is on.
   */
  wrap(code, text) {
    return this.on ? `\x1b[${code}m${text}\x1b[0m` : text;
  },
};

/**
 * Strips anything that could move the cursor or change the terminal's mode.
 *
 * @param {*} value The text, typically read out of a session's log.
 * @returns {string} The text with control characters replaced by spaces.
 */
function sanitise(value) {
  let out = '';
  for (const character of String(value ?? '')) {
    const code = character.codePointAt(0);
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : character;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Cuts text to a width, marking that something was cut.
 *
 * @param {string} text The text.
 * @param {number} width The ceiling.
 * @returns {string} The text, at most `width` characters.
 */
function clip(text, width) {
  const clean = sanitise(text);
  return clean.length <= width ? clean : `${clean.slice(0, width - 1)}…`;
}

/**
 * Money, or a dash when nothing has been spent yet.
 *
 * @param {number|null} value Dollars.
 * @returns {string} `$1.25` or `—`.
 */
function money(value) {
  return typeof value === 'number' ? `$${value.toFixed(2)}` : '—';
}

/**
 * The view itself: owns the terminal, the redraw timer and the key handling.
 */
class Tui {
  /**
   * @param {object} [opts] `{ url }` — the web view's address, shown when both views are running.
   */
  constructor(opts = {}) {
    this.url = opts.url || null;
    this.mode = 'normal';
    this.prompt = null;
    this.buffer = '';
    this.flash = '';
    this.flashBad = false;
    this.clean = false;
    this.expanded = false;
    this.pending = null;
    this.snapshot = null;
    this.timer = null;
    this.stopped = false;
  }

  /**
   * Takes the terminal, starts the redraw loop and begins reading keys.
   *
   * @returns {void}
   */
  start() {
    process.stdout.write('\x1b[?1049h\x1b[?25l');
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (key) => this.onKey(key));
    process.stdout.on('resize', () => this.draw());
    process.on('exit', () => this.restore());
    this.timer = setInterval(() => this.draw(), TICK_MS);
    this.draw();
  }

  /**
   * Gives the terminal back, exactly as it was found.
   *
   * @returns {void}
   */
  restore() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write('\x1b[?25h\x1b[?1049l');
  }

  /**
   * Leaves the view. The run itself is untouched — quitting a watcher is not stopping a build.
   *
   * @returns {void}
   */
  quit() {
    this.restore();
    process.stdout.write(
      'Ralph keeps running. Attach again with `node .claude/ralph-watch.js`.\n',
    );
    process.exit(0);
  }

  /**
   * Shows the outcome of a command under the key bar.
   *
   * @param {{ ok: boolean, why: string }} result What the monitor answered.
   * @returns {void}
   */
  say(result) {
    this.flash = result.why || (result.ok ? 'done' : 'refused');
    this.flashBad = !result.ok;
    this.draw();
  }

  /**
   * Opens a modal that asks before doing something destructive.
   *
   * @param {string} title What is about to happen.
   * @param {Function} action What to run when the answer is yes.
   * @returns {void}
   */
  confirm(title, action) {
    this.mode = 'confirm';
    this.pending = { title, action };
    this.draw();
  }

  /**
   * Opens a one-line editor for a setting.
   *
   * @param {string} key The setting's name.
   * @returns {void}
   */
  edit(key) {
    const spec = monitor.SETTINGS[key];
    this.mode = 'input';
    this.prompt = { key, label: spec ? spec.label : key };
    this.buffer = '';
    this.draw();
  }

  /**
   * Handles one keypress, dispatching on which modal is open.
   *
   * @param {string} key The key, as raw terminal input.
   * @returns {void}
   */
  onKey(key) {
    if (key === '\x03') return this.quit();

    if (this.mode === 'input') return this.onInputKey(key);
    if (this.mode === 'confirm') return this.onConfirmKey(key);
    if (this.mode === 'stop') return this.onStopKey(key);
    if (this.mode === 'hold') return this.onHoldKey(key);
    if (this.mode === 'rollback') return this.onRollbackKey(key);
    return this.onNormalKey(key);
  }

  /**
   * Keys while a setting is being typed.
   *
   * @param {string} key The key.
   * @returns {void}
   */
  onInputKey(key) {
    if (key === '\x1b') {
      this.mode = 'normal';
      this.prompt = null;
      return this.draw();
    }
    if (key === '\r' || key === '\n') {
      const { key: name } = this.prompt;
      const value = this.buffer;
      this.mode = 'normal';
      this.prompt = null;
      return this.say(monitor.applySettings({ [name]: value }));
    }
    if (key === '\x7f' || key === '\b') {
      this.buffer = this.buffer.slice(0, -1);
      return this.draw();
    }
    if (key >= ' ' && key.length === 1) {
      this.buffer += key;
      return this.draw();
    }
    return undefined;
  }

  /**
   * Keys while a confirmation is open.
   *
   * @param {string} key The key.
   * @returns {void}
   */
  onConfirmKey(key) {
    const pending = this.pending;
    if (key === 'y' || key === 'Y') {
      this.mode = 'normal';
      this.pending = null;
      this.flash = 'working…';
      this.draw();
      return this.say(pending.action());
    }
    this.mode = 'normal';
    this.pending = null;
    this.flash = 'cancelled';
    this.flashBad = false;
    return this.draw();
  }

  /**
   * Keys while the stop menu is open.
   *
   * @param {string} key The key.
   * @returns {void}
   */
  onStopKey(key) {
    if (key === 'f' || key === 'F') {
      this.mode = 'normal';
      return this.confirm(
        'Halt the run, letting the link in flight finish first?',
        () => monitor.stop({ kill: false }),
      );
    }
    if (key === 'k' || key === 'K') {
      this.mode = 'normal';
      return this.confirm(
        'Halt the run and kill the link in flight now? Its uncommitted work is lost.',
        () => monitor.stop({ kill: true }),
      );
    }
    this.mode = 'normal';
    return this.draw();
  }

  /**
   * Keys while the hold menu is open. A hold changes nothing about the run now, so unlike stop and
   * rollback it needs no confirmation — pressing the same entry again clears it.
   *
   * @param {string} key The key.
   * @returns {void}
   */
  onHoldKey(key) {
    const holds = {
      1: { action: 'pause', at: 'phase' },
      2: { action: 'stop', at: 'phase' },
      3: { action: 'stop', at: 'task' },
      0: { action: null },
    };
    const chosen = holds[key];
    this.mode = 'normal';
    if (!chosen) return this.draw();
    const armed = this.snapshot && this.snapshot.hold;
    const same =
      armed &&
      chosen.action &&
      armed.action === chosen.action &&
      armed.at === chosen.at;
    return this.say(monitor.hold(same ? { action: null } : chosen));
  }

  /**
   * Keys while the rollback menu is open.
   *
   * @param {string} key The key.
   * @returns {void}
   */
  onRollbackKey(key) {
    if (key === 'c' || key === 'C') {
      this.clean = !this.clean;
      return this.draw();
    }
    const index = Number(key) - 1;
    const mode = monitor.ROLLBACK_MODES[index];
    if (!mode) {
      this.mode = 'normal';
      return this.draw();
    }
    this.mode = 'normal';
    const clean = this.clean;
    return this.confirm(
      `${mode.title}${clean ? ' (and delete untracked files)' : ''} — ${mode.detail}`,
      () => monitor.rollback(mode.key, { clean }),
    );
  }

  /**
   * Keys on the main screen.
   *
   * @param {string} key The key.
   * @returns {void}
   */
  onNormalKey(key) {
    const snapshot = this.snapshot;
    switch (key) {
      case 'q':
      case 'Q':
        return this.quit();
      case 'p':
      case 'P':
        return this.say(
          snapshot && (snapshot.paused || snapshot.stopped)
            ? monitor.resume()
            : monitor.pause(),
        );
      case 's':
      case 'S':
        this.mode = 'stop';
        return this.draw();
      case 'h':
      case 'H':
        this.mode = 'hold';
        return this.draw();
      case 'r':
      case 'R':
        this.mode = 'rollback';
        return this.draw();
      case 'm':
      case 'M':
        return this.edit('model');
      case 'f':
      case 'F':
        return this.edit('fallbackModel');
      case 'e':
      case 'E':
        return this.edit('effort');
      case 't':
      case 'T':
        return this.edit('maxTurnsPerTask');
      case 'b':
      case 'B':
        return this.edit('maxBudgetUsdPerSession');
      case 'n':
      case 'N':
        return this.edit('taskRetries');
      case 'l':
      case 'L':
        this.expanded = !this.expanded;
        return this.draw();
      default:
        return undefined;
    }
  }

  /**
   * Composes the whole screen and paints it in one write.
   *
   * @returns {void}
   */
  draw() {
    if (this.stopped) return;
    let snapshot;
    try {
      snapshot = monitor.snapshot();
    } catch (err) {
      snapshot = { ok: false, why: `snapshot failed: ${err.message}` };
    }
    this.snapshot = snapshot;

    const width = Math.min(
      MAX_WIDTH,
      Math.max(48, process.stdout.columns || 80),
    );
    const inner = width - 4;
    const lines = [];

    /**
     * Adds one framed line.
     *
     * @param {string} [text] The line's content.
     * @returns {void}
     */
    const row = (text = '') => {
      const clipped = clip(text, inner);
      lines.push(
        `│ ${clipped}${' '.repeat(Math.max(0, inner - clipped.length))} │`,
      );
    };
    /**
     * Adds a horizontal rule.
     *
     * @param {string} left The left corner.
     * @param {string} right The right corner.
     * @returns {void}
     */
    const rule = (left, right) =>
      lines.push(left + '─'.repeat(width - 2) + right);

    rule('┌', '┐');
    if (!snapshot.ok) {
      row('Ralph');
      row('');
      row(snapshot.why || 'no run');
      rule('├', '┤');
      row('[q] quit');
      rule('└', '┘');
      this.paint(lines);
      return;
    }

    const p = snapshot.progress;
    const state = snapshot.stopped
      ? colour.wrap('31', 'halted')
      : snapshot.paused
        ? colour.wrap('33', 'paused')
        : snapshot.link && snapshot.link.alive
          ? colour.wrap('32', 'running')
          : 'idle';

    row(
      `Ralph · ${snapshot.feature} · run ${snapshot.runId}${this.url ? ` · ${this.url}` : ''}`,
    );
    row(
      `phase ${p.phaseNumber ?? '—'}/${p.phaseTotal} · ${p.title || 'every phase has settled'}`,
    );
    const done = p.phaseNumber ? p.phaseNumber - 1 : p.phaseTotal;
    const within = p.taskTotal ? (p.taskNumber || 0) / p.taskTotal : 0;
    row(
      `${monitor.progressBar(done + within, p.phaseTotal || 1, Math.max(10, inner - 46))}  ${state}  stage ${snapshot.stage}` +
        (p.taskNumber ? ` · task ${p.taskNumber}/${p.taskTotal}` : ''),
    );
    row(
      `issue ${snapshot.currentIssue ? `#${snapshot.currentIssue}` : '—'}${p.taskId ? ` (${p.taskId})` : ''} · ${snapshot.branch || snapshot.baseBranch} · ${monitor.formatDuration(snapshot.elapsedMs)} elapsed · session ${snapshot.sessions}${snapshot.ceilings.sessions ? `/${snapshot.ceilings.sessions}` : ''} · ${money(snapshot.cost.run)} spent`,
    );

    const link = snapshot.link;
    const settings = snapshot.settings;
    const pendingModel =
      link && link.model && link.model !== settings.model
        ? ` → ${settings.model}`
        : '';
    const pendingEffort =
      link && (link.effort || null) !== (settings.effort || null)
        ? ` → ${settings.effort || 'inherit'}`
        : '';
    row(
      `model ${link && link.model ? link.model : settings.model}${pendingModel} · effort ${(link && link.effort) || settings.effort || 'inherit'}${pendingEffort} · workers ${snapshot.workers.active}/${snapshot.workers.limit} · turns ${settings.maxTurnsPerTask}/task · budget ${money(settings.maxBudgetUsdPerSession)}`,
    );
    if (snapshot.hold)
      row(
        colour.wrap(
          '33',
          `hold: ${snapshot.hold.label} — armed, not yet reached`,
        ),
      );
    if (snapshot.selection && snapshot.selection.stopAfterPhase)
      row(
        colour.wrap(
          '36',
          `taking ${snapshot.selection.kind} ${snapshot.selection.feature} phase ${snapshot.selection.phase} — the run stops once it has settled`,
        ),
      );
    if (!snapshot.active && snapshot.work) {
      const open = snapshot.work.candidates || [];
      row(
        colour.wrap(
          '36',
          open.length
            ? `${open.length} thing${open.length === 1 ? '' : 's'} open — pick one with \`node .claude/ralph-start.js --pick\``
            : 'nothing open — no milestone, phase or feature is waiting',
        ),
      );
    }
    if (snapshot.halt) row(colour.wrap('31', `halt: ${snapshot.halt}`));
    if (snapshot.msError)
      row(colour.wrap('31', `MS file: ${snapshot.msError}`));

    rule('├', '┤');
    const activity = snapshot.activity.length ? snapshot.activity : ['—'];
    const shown = this.expanded ? activity.slice(-10) : activity.slice(-3);
    for (const line of shown) row(`▸ ${line}`);
    const stream = snapshot.stream;
    if (stream) {
      row(
        colour.wrap(
          '90',
          `⋯ ${link && link.alive ? 'live' : stream.finished ? 'finished' : 'idle'} · turn ${stream.turns} · thinking ~${stream.thinking} · ${link && link.elapsedMs ? monitor.formatDuration(link.elapsedMs) : '—'}${stream.cost != null ? ` · ${money(stream.cost)}` : ''}${link ? ` · ${link.logName}` : ''}`,
        ),
      );
    }
    if (snapshot.checks) {
      row(
        colour.wrap(
          snapshot.checks.green ? '32' : '31',
          `checks · phase ${snapshot.checks.phase} ${snapshot.checks.scope} · ${snapshot.checks.green ? 'green' : `red at ${snapshot.checks.failing}`}`,
        ),
      );
    }

    rule('├', '┤');
    if (this.mode === 'stop') {
      row(
        colour.wrap(
          '33',
          'Stop: [f] after the current link · [k] kill it now · [esc] cancel',
        ),
      );
    } else if (this.mode === 'hold') {
      row(colour.wrap('33', 'Hold — armed now, acts at a boundary later:'));
      row(
        '[1] pause when this phase ends — merged, settled, on the base branch',
      );
      row('[2] stop when this phase ends — --resume opens the next phase');
      row('[3] stop when this task ends — --resume takes the next task');
      row(
        `[0] clear · [esc] cancel · ${snapshot.hold ? `armed: ${snapshot.hold.label}` : 'nothing armed'}`,
      );
    } else if (this.mode === 'rollback') {
      row(colour.wrap('33', 'Roll back:'));
      monitor.ROLLBACK_MODES.forEach((mode, i) => {
        row(`  [${i + 1}] ${mode.title} — ${mode.detail}`);
      });
      row(
        `  [c] also delete untracked files: ${this.clean ? 'yes' : 'no'} · [esc] cancel` +
          (snapshot.lastMerge
            ? ` · last merge PR #${snapshot.lastMerge.pr}`
            : ' · nothing merged yet'),
      );
    } else if (this.mode === 'confirm') {
      row(colour.wrap('33', this.pending.title));
      row('[y] yes · any other key cancels');
    } else if (this.mode === 'input') {
      row(`${this.prompt.label}: ${this.buffer}▌`);
      row(
        colour.wrap(
          '90',
          this.prompt.key === 'effort'
            ? `one of ${monitor.EFFORTS.join(', ')}, or empty to inherit · [enter] save · [esc] cancel`
            : 'empty clears the override · [enter] save · [esc] cancel',
        ),
      );
    } else {
      row(
        `[p] ${snapshot.paused || snapshot.stopped ? 'resume' : 'pause'}  [s] stop  [h] hold${snapshot.hold ? '*' : ''}  [r] rollback  [m] model  [f] fallback  [e] effort`,
      );
      row(
        '[t] turns  [b] budget  [n] retries  [l] more lines  [q] quit watching',
      );
      if (this.flash) row(colour.wrap(this.flashBad ? '31' : '90', this.flash));
    }
    rule('└', '┘');
    this.paint(lines);
  }

  /**
   * Writes a composed screen, clearing each line as it goes rather than clearing the whole screen,
   * which is what stops the panel flickering.
   *
   * @param {string[]} lines The screen.
   * @returns {void}
   */
  paint(lines) {
    process.stdout.write(
      `\x1b[H${lines.map((l) => `\x1b[2K${l}`).join('\n')}\n\x1b[J`,
    );
  }
}

/**
 * Runs the terminal view until the person quits it.
 *
 * @param {object} [opts] `{ url }` when a web view is running alongside.
 * @returns {Tui} The running view.
 */
function run(opts = {}) {
  const tui = new Tui(opts);
  tui.start();
  return tui;
}

module.exports = { Tui, clip, run, sanitise };
