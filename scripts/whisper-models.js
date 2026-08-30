'use strict';

/**
 * Provisions the Whisper engine's weights: `npm run whisper:models`.
 *
 * AC-12 forbids any lookup leaving the machine while a transcription runs, so
 * the weights have to already be on disk before the first one starts (D-10).
 * This script is that setup step — it downloads `ggml-${WHISPER_MODEL}.bin`
 * once into the gitignored `.data/whisper-models/` that `docker-compose.yml`
 * mounts read-only into the engine, verifies it against the SHA1 whisper.cpp
 * publishes, and does nothing at all on every later run.
 *
 * The download is the whole feature's only fetch from a general-purpose host,
 * which is why the SHA1 gate is not optional: the bytes become the model an
 * owner's recording is transcribed by, and a wrong or tampered file would show
 * up as a quietly worse transcript rather than as an error. The file only ever
 * reaches its final name after it has passed the gate.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

/** Model provisioned when `WHISPER_MODEL` is unset, matching `.env.example`. */
const DEFAULT_MODEL = 'tiny';

/**
 * The SHA1 whisper.cpp publishes per model, copied from its models README.
 * Only the models this repo has a published checksum for on hand are listed;
 * anything else is provisioned by supplying `WHISPER_MODEL_SHA1` explicitly,
 * so raising `WHISPER_MODEL` never means inventing a checksum here.
 */
const MODEL_SHA1 = {
  tiny: 'bd577a113a864445d4c299885e0cb97d4ba92b5f',
};

/** Where whisper.cpp publishes the GGML weights. */
const MODEL_HOST = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

/** The repository root, which every relative path here is resolved against. */
const REPO_ROOT = path.join(__dirname, '..');

/** Models directory when `WHISPER_MODELS_DIR` is unset, matching compose. */
const DEFAULT_MODELS_DIR = path.join(REPO_ROOT, '.data', 'whisper-models');

/**
 * A model name whisper.cpp publishes — `tiny`, `base.en`, `large-v3`. The
 * pattern is narrow on purpose: the value is an environment variable that ends
 * up in a file path and in a URL, so a separator, a dot pair or a space is
 * refused rather than escaped.
 */
const MODEL_NAME_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** What a SHA1 looks like once it is written down. */
const SHA1_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Names the weights file for a model.
 * @param {string} model - Model name, already validated.
 * @returns {string} The file name the engine's `-m` flag points at.
 */
function modelFileName(model) {
  return `ggml-${model}.bin`;
}

/**
 * Builds the URL the weights are downloaded from.
 * @param {string} model - Model name, already validated.
 * @returns {string} The published location of that model's weights.
 */
function modelDownloadUrl(model) {
  return `${MODEL_HOST}/${modelFileName(model)}`;
}

/**
 * Reads the model to provision out of the environment.
 * @param {NodeJS.ProcessEnv} env - Environment to read `WHISPER_MODEL` from.
 * @returns {string} The model name, defaulted and validated.
 * @throws {Error} When `WHISPER_MODEL` is not a name whisper.cpp publishes.
 */
function resolveModel(env) {
  const model = env.WHISPER_MODEL || DEFAULT_MODEL;
  if (!MODEL_NAME_PATTERN.test(model)) {
    throw new Error(
      `WHISPER_MODEL="${model}" is not a whisper.cpp model name. Use one of the names in https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md, such as "tiny" or "base".`,
    );
  }
  return model;
}

/**
 * Decides which SHA1 the downloaded weights must match.
 * @param {string} model - Model name, already validated.
 * @param {NodeJS.ProcessEnv} env - Environment to read the override from.
 * @returns {string} The expected SHA1, lowercased.
 * @throws {Error} When the model has no pinned SHA1 and none was supplied, or
 *   when the supplied one is not a SHA1.
 */
function resolveExpectedSha1(model, env) {
  const supplied = env.WHISPER_MODEL_SHA1;
  if (supplied !== undefined && supplied !== '') {
    const normalised = supplied.trim().toLowerCase();
    if (!SHA1_PATTERN.test(normalised)) {
      throw new Error(
        `WHISPER_MODEL_SHA1="${supplied}" is not a SHA1 — it must be 40 hexadecimal characters, as whisper.cpp publishes them.`,
      );
    }
    return normalised;
  }

  const pinned = MODEL_SHA1[model];
  if (!pinned) {
    throw new Error(
      `No SHA1 is pinned for model "${model}". Take the one whisper.cpp publishes for it (https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md) and pass it as WHISPER_MODEL_SHA1, so the weights are still verified before they are used.`,
    );
  }
  return pinned;
}

/**
 * Reads the directory the weights are provisioned into. It is the same value
 * `docker-compose.yml` mounts from, so the two cannot drift: the default is
 * the gitignored `.data/whisper-models/` beside `.data/uploads`, and
 * `WHISPER_MODELS_DIR` moves both together on a machine whose Docker cannot
 * bind-mount the repository — Docker Desktop shares only the directories
 * listed in its settings, and a checkout outside them mounts as an empty
 * directory rather than failing, which the engine reports as a model it
 * cannot open. Relative values resolve against the repository root, the way
 * compose resolves the path in the volume, and `~` is not expanded for the
 * same reason.
 * @param {NodeJS.ProcessEnv} env - Environment to read `WHISPER_MODELS_DIR` from.
 * @returns {string} Absolute path of the models directory.
 */
function resolveModelsDir(env) {
  const configured = env.WHISPER_MODELS_DIR;
  if (!configured) {
    return DEFAULT_MODELS_DIR;
  }
  return path.resolve(REPO_ROOT, configured);
}

/**
 * Digests a file on disk without holding it in memory.
 * @param {string} filePath - File to digest.
 * @returns {Promise<string>} The file's SHA1, lowercase hexadecimal.
 */
async function sha1OfFile(filePath) {
  const hash = crypto.createHash('sha1');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

/**
 * Downloads a URL to a file, streaming it rather than buffering 75 MiB.
 * @param {string} url - Where to fetch from.
 * @param {string} destination - File to write, replaced if it exists.
 * @returns {Promise<void>} Resolves once every byte is on disk.
 * @throws {Error} When the host answers anything other than 2xx, or with no body.
 */
async function downloadTo(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(
      `Downloading ${url} failed with HTTP ${response.status} ${response.statusText}.`,
    );
  }
  await pipeline(
    Readable.fromWeb(response.body),
    fs.createWriteStream(destination),
  );
}

/**
 * Puts a model's weights in place, once, and proves they are the published
 * ones. A file already there is verified rather than trusted, and freshly
 * downloaded bytes are verified under a `.part` name so a failed or
 * interrupted download can never be mistaken for a provisioned model.
 * @param {object} options - What to provision and where.
 * @param {string} options.model - Model name, already validated.
 * @param {string} options.modelsDir - Directory the weights live in.
 * @param {string} options.expectedSha1 - SHA1 the weights must match.
 * @param {(url: string, destination: string) => Promise<void>} [options.download]
 *   How to fetch the bytes; defaults to the real download.
 * @returns {Promise<{ status: 'present' | 'downloaded', filePath: string, sha1: string }>}
 *   Where the weights are, and whether this run had to fetch them.
 * @throws {Error} When the bytes on disk do not match `expectedSha1`.
 */
async function provisionModel({
  model,
  modelsDir,
  expectedSha1,
  download = downloadTo,
}) {
  const filePath = path.join(modelsDir, modelFileName(model));
  await fsp.mkdir(modelsDir, { recursive: true });

  if (fs.existsSync(filePath)) {
    const sha1 = await sha1OfFile(filePath);
    if (sha1 !== expectedSha1) {
      throw new Error(
        `${filePath} does not match the published SHA1 (expected ${expectedSha1}, found ${sha1}). Delete the file and run this script again rather than transcribing with weights nobody can vouch for.`,
      );
    }
    return { status: 'present', filePath, sha1 };
  }

  const partPath = `${filePath}.part`;
  try {
    await download(modelDownloadUrl(model), partPath);
    const sha1 = await sha1OfFile(partPath);
    if (sha1 !== expectedSha1) {
      throw new Error(
        `The download of ${modelFileName(model)} does not match the published SHA1 (expected ${expectedSha1}, found ${sha1}). Nothing was kept.`,
      );
    }
    await fsp.rename(partPath, filePath);
    return { status: 'downloaded', filePath, sha1 };
  } finally {
    await fsp.rm(partPath, { force: true });
  }
}

/**
 * Runs the provisioning step as the npm script does.
 * @returns {Promise<void>} Resolves once the weights are in place.
 * @throws {Error} When the model, the checksum or the bytes do not check out.
 */
async function main() {
  const model = resolveModel(process.env);
  const expectedSha1 = resolveExpectedSha1(model, process.env);
  const result = await provisionModel({
    model,
    modelsDir: resolveModelsDir(process.env),
    expectedSha1,
  });

  const what =
    result.status === 'present'
      ? 'already provisioned'
      : 'downloaded and verified';
  process.stdout.write(
    `Whisper model "${model}" ${what}: ${result.filePath} (sha1 ${result.sha1})\n`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MODEL,
  DEFAULT_MODELS_DIR,
  MODEL_SHA1,
  modelFileName,
  modelDownloadUrl,
  resolveModel,
  resolveModelsDir,
  resolveExpectedSha1,
  sha1OfFile,
  provisionModel,
};
