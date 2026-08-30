'use strict';

/**
 * The weight provisioner's suite: `node --test scripts/whisper-models.test.js`.
 *
 * Everything here is offline. The one thing this script does that nothing else
 * in the repo does — fetch a 75 MiB binary from a general-purpose host — is
 * injected, so the cases can prove what happens around the download (the SHA1
 * gate, the partial file, the second run) without performing one.
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const whisperModels = require('./whisper-models');

/** The SHA1 whisper.cpp publishes for `tiny` (D-10, research §5). */
const TINY_SHA1 = 'bd577a113a864445d4c299885e0cb97d4ba92b5f';

/**
 * Makes a scratch directory the case owns, removed when the process exits.
 * @returns {string} Absolute path of the new directory.
 */
function makeScratchDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-models-'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Builds a download stub that writes fixed bytes and records its calls.
 * @param {string|Buffer} bytes - What the stub writes to the destination.
 * @returns {{ (url: string, destination: string): Promise<void>, calls: Array<{ url: string, destination: string }> }}
 *   The stub, carrying the calls it received.
 */
function stubDownload(bytes) {
  /** @type {Array<{ url: string, destination: string }>} */
  const calls = [];
  /**
   * Stands in for the real fetch.
   * @param {string} url - Where the bytes would have come from.
   * @param {string} destination - Where to write them.
   * @returns {Promise<void>} Resolves once written.
   */
  const download = async (url, destination) => {
    calls.push({ url, destination });
    fs.writeFileSync(destination, bytes);
  };
  download.calls = calls;
  return download;
}

test('the file name and the download URL are pinned to the model', () => {
  assert.strictEqual(whisperModels.modelFileName('tiny'), 'ggml-tiny.bin');
  assert.strictEqual(
    whisperModels.modelDownloadUrl('tiny'),
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  );
});

test('an unset WHISPER_MODEL provisions tiny', () => {
  assert.strictEqual(whisperModels.resolveModel({}), 'tiny');
  assert.strictEqual(whisperModels.resolveModel({ WHISPER_MODEL: '' }), 'tiny');
  assert.strictEqual(
    whisperModels.resolveModel({ WHISPER_MODEL: 'base' }),
    'base',
  );
});

test('a model name that could escape the models directory is refused', () => {
  for (const model of [
    '../../etc/passwd',
    '..',
    'a/b',
    'a\\b',
    '/absolute',
    'tiny;rm -rf /',
    'tiny ',
  ]) {
    assert.throws(
      () => whisperModels.resolveModel({ WHISPER_MODEL: model }),
      /WHISPER_MODEL/,
      `expected "${model}" to be refused`,
    );
  }
});

test('the model names whisper.cpp publishes are accepted', () => {
  for (const model of ['tiny', 'tiny.en', 'base', 'base.en', 'large-v3']) {
    assert.strictEqual(
      whisperModels.resolveModel({ WHISPER_MODEL: model }),
      model,
    );
  }
});

test('tiny verifies against the SHA1 whisper.cpp publishes', () => {
  assert.strictEqual(whisperModels.resolveExpectedSha1('tiny', {}), TINY_SHA1);
});

test('a model with no pinned SHA1 is refused, naming the way to supply one', () => {
  assert.throws(
    () => whisperModels.resolveExpectedSha1('large-v3', {}),
    /WHISPER_MODEL_SHA1/,
  );
});

test('a supplied SHA1 is used, normalised, and must look like one', () => {
  const supplied = TINY_SHA1.toUpperCase();
  assert.strictEqual(
    whisperModels.resolveExpectedSha1('large-v3', {
      WHISPER_MODEL_SHA1: supplied,
    }),
    TINY_SHA1,
  );
  for (const value of [
    '',
    'not-a-sha1',
    TINY_SHA1.slice(0, 39),
    `${TINY_SHA1}0`,
  ]) {
    assert.throws(
      () =>
        whisperModels.resolveExpectedSha1('large-v3', {
          WHISPER_MODEL_SHA1: value,
        }),
      /WHISPER_MODEL_SHA1/,
      `expected "${value}" to be refused`,
    );
  }
});

test('sha1OfFile digests the file on disk', async () => {
  const dir = makeScratchDir();
  const file = path.join(dir, 'weights.bin');
  fs.writeFileSync(file, 'the weights');
  assert.strictEqual(
    await whisperModels.sha1OfFile(file),
    crypto.createHash('sha1').update('the weights').digest('hex'),
  );
});

test('the first run downloads, verifies and leaves no partial file', async () => {
  const dir = makeScratchDir();
  const bytes = 'the weights';
  const download = stubDownload(bytes);

  const result = await whisperModels.provisionModel({
    model: 'tiny',
    modelsDir: dir,
    expectedSha1: crypto.createHash('sha1').update(bytes).digest('hex'),
    download,
  });

  assert.strictEqual(result.status, 'downloaded');
  assert.strictEqual(download.calls.length, 1);
  assert.strictEqual(
    download.calls[0].url,
    whisperModels.modelDownloadUrl('tiny'),
  );
  assert.deepStrictEqual(fs.readdirSync(dir), ['ggml-tiny.bin']);
  assert.strictEqual(
    fs.readFileSync(path.join(dir, 'ggml-tiny.bin'), 'utf8'),
    bytes,
  );
});

test('the models directory is created when it is not there yet', async () => {
  const dir = path.join(makeScratchDir(), 'nested', 'whisper-models');
  const bytes = 'the weights';

  await whisperModels.provisionModel({
    model: 'tiny',
    modelsDir: dir,
    expectedSha1: crypto.createHash('sha1').update(bytes).digest('hex'),
    download: stubDownload(bytes),
  });

  assert.ok(fs.existsSync(path.join(dir, 'ggml-tiny.bin')));
});

test('a second run downloads nothing', async () => {
  const dir = makeScratchDir();
  const bytes = 'the weights';
  fs.writeFileSync(path.join(dir, 'ggml-tiny.bin'), bytes);
  const download = stubDownload(bytes);

  const result = await whisperModels.provisionModel({
    model: 'tiny',
    modelsDir: dir,
    expectedSha1: crypto.createHash('sha1').update(bytes).digest('hex'),
    download,
  });

  assert.strictEqual(result.status, 'present');
  assert.strictEqual(download.calls.length, 0);
});

test('bytes that fail the SHA1 gate never become the model file', async () => {
  const dir = makeScratchDir();
  const download = stubDownload('tampered weights');

  await assert.rejects(
    whisperModels.provisionModel({
      model: 'tiny',
      modelsDir: dir,
      expectedSha1: TINY_SHA1,
      download,
    }),
    /SHA1/,
  );

  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('a model file already on disk that fails the gate is reported, not used', async () => {
  const dir = makeScratchDir();
  const file = path.join(dir, 'ggml-tiny.bin');
  fs.writeFileSync(file, 'tampered weights');
  const download = stubDownload('tampered weights');

  await assert.rejects(
    whisperModels.provisionModel({
      model: 'tiny',
      modelsDir: dir,
      expectedSha1: TINY_SHA1,
      download,
    }),
    /SHA1/,
  );

  assert.strictEqual(download.calls.length, 0);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'tampered weights');
});
