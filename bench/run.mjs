#!/usr/bin/env node
/**
 * Carbone benchmark runner.
 *
 * For each requested number of Carbone factories (CPU), it starts a Carbone
 * container, uploads every template once with `POST /template`, then runs every
 * sample of the matrix through k6 (merge only, and PDF conversion with
 * LibreOffice / OnlyOffice / Carbone ICE / Chromium), at each requested
 * concurrency, and finally writes one JSON result per run plus the charts, the
 * tables and the CSV.
 *
 * The measured requests are `POST /render/:templateVersionId` and only carry
 * the JSON dataset: uploading the template is not part of what is measured.
 *
 *   node bench/run.mjs                       full benchmark (1 and 4 CPU, 10 VU)
 *   node bench/run.mjs --duration 10s        quick check
 *   node bench/run.mjs --cpus 4 --no-docker  use a Carbone server you started yourself
 *   node bench/run.mjs --dry-run             only print what would be executed
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { buildMatrix, buildPayload, discoverSamples, looksValid, readData, ROOT_DIR } from './matrix.mjs';
import { generateReport } from './report.mjs';

const PREVIEWS_DIR = path.join(ROOT_DIR, 'docs', 'previews');

const DEFAULTS = {
  image     : 'carbone/carbone-ee:full-5.14.0',
  container : 'carbone-bench',
  port      : 4000,
  cpus      : '1,4',
  vus       : '10',
  duration  : '30s',
  warmup    : 3,
  warmupRetries : 3,
  cooldown  : 3,
  results   : 'results',
  startupTimeout : 120,
  requestTimeout : 60,
};

function parseArgs (argv) {
  const options = {
    image      : process.env.CARBONE_IMAGE || DEFAULTS.image,
    container  : process.env.CARBONE_CONTAINER || DEFAULTS.container,
    port       : Number(process.env.CARBONE_PORT || DEFAULTS.port),
    cpus       : String(process.env.CARBONE_CPUS || DEFAULTS.cpus),
    vus        : String(process.env.CARBONE_VUS || DEFAULTS.vus),
    duration   : process.env.CARBONE_DURATION || DEFAULTS.duration,
    warmup     : Number(process.env.CARBONE_WARMUP ?? DEFAULTS.warmup),
    cooldown   : Number(process.env.CARBONE_COOLDOWN ?? DEFAULTS.cooldown),
    results    : process.env.CARBONE_RESULTS || DEFAULTS.results,
    dockerCpus : process.env.CARBONE_DOCKER_CPUS || '',
    licenseFile: process.env.CARBONE_LICENSE_FILE || '',
    shmSize    : process.env.CARBONE_SHM_SIZE || '',
    warmupRetries : Number(process.env.CARBONE_WARMUP_RETRIES ?? DEFAULTS.warmupRetries),
    env        : [],
    startupTimeout : Number(process.env.CARBONE_STARTUP_TIMEOUT || DEFAULTS.startupTimeout),
    requestTimeout : Number(process.env.CARBONE_REQUEST_TIMEOUT || DEFAULTS.requestTimeout),
    filter     : '',
    docker     : true,
    dryRun     : false,
    keep       : false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      return value;
    };

    switch (arg) {
      case '--image':        options.image = next(); break;
      case '--container':    options.container = next(); break;
      case '--port':         options.port = Number(next()); break;
      case '--cpus':         options.cpus = next(); break;
      case '--vus':          options.vus = next(); break;
      case '--duration':     options.duration = next(); break;
      case '--warmup':       options.warmup = Number(next()); break;
      case '--warmup-retries': options.warmupRetries = Number(next()); break;
      case '--cooldown':     options.cooldown = Number(next()); break;
      case '--results':      options.results = next(); break;
      case '--docker-cpus':  options.dockerCpus = next(); break;
      case '--license-file': options.licenseFile = next(); break;
      case '--shm-size':     options.shmSize = next(); break;
      case '-e':
      case '--env':          options.env.push(next()); break;
      case '--startup-timeout': options.startupTimeout = Number(next()); break;
      case '--request-timeout': options.requestTimeout = Number(next()); break;
      case '--filter':       options.filter = next(); break;
      case '--no-docker':    options.docker = false; break;
      case '--keep':         options.keep = true; break;
      case '--dry-run':      options.dryRun = true; break;
      case '-h':
      case '--help':         options.help = true; break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.cpuList = options.cpus.split(',').map((value) => Number(value.trim())).filter(Boolean);
  options.vuList = String(options.vus).split(',').map((value) => Number(value.trim())).filter(Boolean);

  if (options.vuList.length === 0) {
    throw new Error('--vus must be a positive number, ex: 10');
  }

  return options;
}

const HELP = `
Usage: node bench/run.mjs [options]

  --cpus <list>       Carbone factories to benchmark            (default ${DEFAULTS.cpus})
  --duration <time>   k6 duration per run                       (default ${DEFAULTS.duration})
  --vus <n>           concurrent virtual users                   (default ${DEFAULTS.vus})
  --filter <text>     only run matrix entries matching <text>
  --image <image>     Carbone docker image                       (default ${DEFAULTS.image})
  --port <port>       host port bound to the container           (default ${DEFAULTS.port})
  --container <name>  container name                             (default ${DEFAULTS.container})
  --docker-cpus <n>   also limit the container to n host CPUs    (default: no limit)
  --license-file <f>  mount an enterprise license into the container
  --env KEY=VALUE     extra environment variable for the container (repeatable)
  --shm-size <size>   /dev/shm size, ex: 1g (Chromium and LibreOffice like it)
  --startup-timeout <sec>  how long to wait for Carbone to listen (default ${DEFAULTS.startupTimeout})
  --request-timeout <sec>  give up on a warmup render after n seconds (default ${DEFAULTS.requestTimeout})
  --no-docker         do not manage docker, use the running Carbone server
  --warmup <number>   warmup renders before each run             (default ${DEFAULTS.warmup})
  --warmup-retries <n>  extra warmup attempts on connection reset (default ${DEFAULTS.warmupRetries})
  --cooldown <sec>    pause between runs                         (default ${DEFAULTS.cooldown})
  --results <dir>     where JSON results are written             (default ${DEFAULTS.results})
  --keep              keep the container running at the end
  --dry-run           print the plan and exit
`;

const log = (message = '') => process.stdout.write(`${message}\n`);

function sh (command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function requireBinary (name, versionArgs) {
  const result = sh(name, versionArgs);

  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`\`${name}\` is required but not usable. ${result.stderr || result.error?.message || ''}`.trim());
  }

  return (result.stdout || '').trim().split('\n')[0];
}

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/* ------------------------------------------------------------------ docker */

function removeContainer (options) {
  sh('docker', ['rm', '-f', options.container], { stdio: 'ignore' });
}

/** Enterprise licenses: v5 name first, legacy name kept for older images. */
const LICENSE_VARS = ['CARBONE_LICENSE', 'CARBONE_EE_LICENSE'];

function startContainer (options, cpu) {
  removeContainer(options);

  // Kept as close as possible to the documented `docker run` command: every
  // extra flag is opt-in, so the runner behaves like a manual start
  const args = ['run', '-d', '--name', options.container, '-p', `${options.port}:4000`];

  if (options.dockerCpus !== '') {
    args.push('--cpus', options.dockerCpus);
  }
  if (options.shmSize !== '') {
    args.push('--shm-size', options.shmSize);
  }

  for (const variable of options.env) {
    args.push('-e', variable);
  }

  for (const variable of LICENSE_VARS) {
    if ((process.env[variable] ?? '') !== '') {
      args.push('-e', variable);
    }
  }

  if (options.licenseFile !== '') {
    const licensePath = path.resolve(options.licenseFile);

    if (fs.existsSync(licensePath) === false) {
      throw new Error(`License file not found: ${licensePath}`);
    }

    args.push('-v', `${licensePath}:/app/config/bench.carbone-license:ro`);
  }

  args.push(options.image, 'webserver', '-s', '-f', String(cpu));

  log(`\n▶ docker ${args.join(' ')}`);

  const result = sh('docker', args);

  if (result.status !== 0) {
    throw new Error(`Unable to start the Carbone container:\n${result.stderr || result.stdout}`);
  }
}

/**
 * 'running' | 'exited' | 'unknown'
 *
 * Anything we cannot read with certainty is 'unknown': a false negative here
 * used to abort the whole benchmark while the container was perfectly healthy.
 */
function containerState (options) {
  const result = sh('docker', ['inspect', '-f', '{{.State.Running}} {{.State.ExitCode}}', options.container]);

  if (result.status !== 0) {
    return { state: 'unknown', detail: (result.stderr || result.error?.message || 'docker inspect failed').trim() };
  }

  const output = (result.stdout || '').trim();
  const [running, exitCode] = output.split(/\s+/);

  if (running === 'true') {
    return { state: 'running', detail: output };
  }
  if (running === 'false') {
    return { state: 'exited', detail: `exit code ${exitCode ?? '?'}` };
  }

  return { state: 'unknown', detail: `unexpected \`docker inspect\` output: "${output}"` };
}

function containerLogs (options, lines = 40) {
  const result = sh('docker', ['logs', '--tail', String(lines), options.container]);

  return `${result.stdout || ''}${result.stderr || ''}`.trim() || '(no log)';
}

const indent = (text) => text.split('\n').map((line) => `    ${line}`).join('\n');

/** Network level failure, as opposed to Carbone answering with an HTTP error. */
const isNetworkError = (message = '') => /ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|socket hang up|no answer/i.test(message);

/** Resolves to null when GET /status returns 200, to an error label otherwise. */
function probeStatus (port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const request = http.request({
      host   : '127.0.0.1',
      port   : port,
      method : 'GET',
      path   : '/status',
      agent  : false,
    }, (response) => {
      response.resume();

      if (response.statusCode === 200) {
        resolve(null);
        return;
      }

      resolve(`GET /status → HTTP ${response.statusCode}`);
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy();
      resolve('GET /status timed out');
    });
    request.on('error', (error) => resolve(error.code || error.message));
    request.end();
  });
}

/**
 * Waits until Carbone answers GET /status with 200, not just until the port is open.
 * The HTTP server can accept TCP before factories are ready; rendering then hits ECONNRESET.
 */
async function waitForServer (options) {
  const deadline = Date.now() + options.startupTimeout * 1000;
  const startedAt = Date.now();
  let lastError = 'not attempted';
  let notified = -1;

  log(`  waiting for GET http://127.0.0.1:${options.port}/status → 200 (up to ${options.startupTimeout}s)`);

  while (Date.now() < deadline) {
    lastError = await probeStatus(options.port);

    if (lastError === null) {
      log(`  ready after ${((Date.now() - startedAt) / 1000).toFixed(1)}s (GET /status 200)`);
      return;
    }

    if (options.docker === true) {
      const { state, detail } = containerState(options);

      // Only a container we are sure is dead stops the benchmark
      if (state === 'exited') {
        throw new Error(`The Carbone container stopped during startup (${detail}).\n\n${containerLogs(options)}`);
      }
      if (state === 'unknown') {
        log(`  note: cannot read the container state (${detail})`);
      }
    }

    const waited = Math.round((Date.now() - startedAt) / 1000);

    if (waited >= notified + 10) {
      notified = waited;
      log(`  still waiting after ${waited}s (${lastError})`);
    }

    await sleep(1);
  }

  throw new Error([
    `Carbone did not answer GET /status with 200 on 127.0.0.1:${options.port} after ${options.startupTimeout}s.`,
    `Last error: ${lastError}`,
    '',
    `Check by hand with: curl -v http://127.0.0.1:${options.port}/status`,
    'If your browser reaches Carbone on another host or port, pass --port <port>.',
    options.docker === true ? `\nContainer logs:\n${containerLogs(options)}` : '',
  ].join('\n'));
}

/* ------------------------------------------------------------------- http */

const renderPath = (templateId) => `/render/${templateId}?download=true`;
const renderUrl = (options, templateId) => `http://127.0.0.1:${options.port}${renderPath(templateId)}`;

/** POST a JSON body to Carbone with node:http, no dependency on global fetch. */
function postJson (options, urlPath, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(payload, 'utf8');

    const request = http.request({
      host    : '127.0.0.1',
      port    : options.port,
      method  : 'POST',
      path    : urlPath,
      // A dedicated socket per call, never a pooled one that the server may
      // be closing at the same moment
      agent   : false,
      headers : {
        'Content-Type'   : 'application/json',
        'Content-Length' : body.length,
        Connection       : 'close',
      },
    }, (response) => {
      const chunks = [];

      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }));
    });

    // Inactivity timeout: a call that never answers must not block the suite
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`no answer after ${Math.round(timeoutMs / 1000)}s`));
    });
    request.on('error', reject);
    request.end(body);
  });
}

/** How hard the calls made before the measured runs try. */
const setupBudget = (options) => ({
  attempts  : Math.max(5, options.warmupRetries + 2),
  timeoutMs : Math.max(options.requestTimeout, 90) * 1000,
});

/**
 * Posts until `validate` accepts the answer, and returns whatever it accepted.
 *
 * Carbone closes sockets while it spawns its converter workers, so transient
 * network failures are retried; anything else is thrown as is.
 */
async function postUntilValid (options, { path: urlPath, payload, validate, label, attempts, timeoutMs }) {
  let lastError = 'no attempt';

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { status, body } = await postJson(options, urlPath, payload, timeoutMs);

      if (status !== 200) {
        lastError = `HTTP ${status} ${body.toString('utf8').slice(0, 200)}`;
      } else {
        const value = validate(body);

        if (value !== null) {
          return value;
        }

        lastError = `unexpected answer (${body.length} bytes)`;
      }
    } catch (error) {
      lastError = error.message;

      if (isNetworkError(error.message) === false) {
        throw error;
      }
    }

    if (attempt < attempts) {
      log(`    ${label} ${attempt}/${attempts} → ${lastError} (retrying)`);
      await sleep(2);
    }
  }

  throw new Error(lastError);
}

/* -------------------------------------------------------------- templates */

/**
 * Reads the version id out of a `POST /template` answer:
 * `{ success: true, data: { id, versionId } }`.
 *
 * The version id (sha256 of the file) pins the exact template. Servers with
 * versioning disabled answer with `templateId`, the same id under its v4 name.
 */
function readVersionId (body) {
  let answer = null;

  try {
    answer = JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }

  const id = answer?.data?.versionId ?? answer?.data?.templateId ?? answer?.data?.id;

  return typeof id === 'string' && id !== '' ? id : null;
}

/** Stores one template and returns its version id. */
function uploadTemplate (options, sample) {
  const template = fs.readFileSync(sample.templatePath);

  // Documented constraint: `template` must be the last field of the body
  const payload = JSON.stringify({
    versioning : true,
    template   : `data:${sample.mime};base64,${template.toString('base64')}`,
  });

  return postUntilValid(options, {
    ...setupBudget(options),
    path     : '/template',
    payload  : payload,
    label    : sample.templateFile,
    validate : readVersionId,
  });
}

/**
 * Uploads every template once, so that the measured renders only carry their
 * JSON dataset instead of the base64 template.
 *
 * A container starts with an empty template storage, hence one upload round per
 * container.
 *
 * @return {Map} sample id -> { versionId, error }, one entry per sample
 */
async function uploadTemplates (options, samples) {
  const templates = new Map();

  log(`\nUploading ${samples.length} template${samples.length > 1 ? 's' : ''} (POST /template)`);

  for (const sample of samples) {
    try {
      const versionId = await uploadTemplate(options, sample);

      templates.set(sample.id, { versionId: versionId, error: null });
      log(`  ${sample.templateFile} → ${versionId}`);
    } catch (error) {
      templates.set(sample.id, { versionId: null, error: `POST /template failed: ${error.message}` });
      log(`  ⚠ ${sample.templateFile}: ${error.message}`);
    }
  }

  return templates;
}

/** The samples the runs actually use, `--filter` can select a subset. */
function usedSamples (samples, runs) {
  const used = new Set(runs.map((run) => run.sampleId));

  return samples.filter((sample) => used.has(sample.id) === true);
}

/* ----------------------------------------------------------------- warmup */

/**
 * Renders the document until `warmup` valid documents are produced.
 *
 * Carbone spawns its converter workers on the first render of a kind, and the
 * connection is sometimes reset while it does. Those resets are transient, so
 * they are retried: a run is only skipped when Carbone never produced a valid
 * document, not when one attempt out of three failed.
 */
async function warmup (options, run, payload, templateId) {
  const wanted = Math.max(1, options.warmup);
  const maxAttempts = wanted + Math.max(2, options.warmupRetries);
  let successes = 0;
  let lastError = 'no attempt';
  let attempt = 0;

  log(`  payload ${(Buffer.byteLength(payload) / 1024).toFixed(1)} KB · warming up ${wanted}×`);

  while (successes < wanted && attempt < maxAttempts) {
    attempt++;

    const startedAt = Date.now();
    const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

    try {
      const { status, body } = await postJson(options, renderPath(templateId), payload, options.requestTimeout * 1000);

      if (status !== 200) {
        lastError = `HTTP ${status} ${body.toString('utf8').slice(0, 300)}`;
      } else if (looksValid(body, run.outputExt) === false) {
        lastError = `unexpected ${run.outputExt} output (${body.length} bytes): ${body.toString('utf8').slice(0, 200)}`;
      } else {
        successes++;
        log(`    ${attempt} ${elapsed()} → ${run.outputExt} ok, ${(body.length / 1024).toFixed(1)} KB`);
        continue;
      }

      log(`    ${attempt} ${elapsed()} → ${lastError}`);
    } catch (error) {
      lastError = error.message;
      log(`    ${attempt} ${elapsed()} → ${lastError} (retrying)`);

      // Give the converter workers time to finish spawning
      await sleep(2);
    }
  }

  if (successes > 0) {
    if (successes < wanted) {
      log(`  warmed up ${successes}/${wanted} (last error: ${lastError})`);
    }

    return null;
  }

  return lastError;
}

/* --------------------------------------------------------------- previews */

function firstImageFromZip (buffer) {
  let offset = 0;

  while (offset < buffer.length - 30 && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = buffer.subarray(dataStart, dataStart + compSize);

    if (/\.(jpe?g|png)$/i.test(name) === true) {
      if (method === 0) {
        return Buffer.from(data);
      }
      if (method === 8) {
        return zlib.inflateRawSync(data);
      }
    }

    offset = dataStart + compSize;
  }

  return null;
}

function asJpeg (buffer) {
  if (looksValid(buffer, 'jpg') === true) {
    return buffer;
  }

  if (buffer.subarray(0, 2).toString('latin1') === 'PK') {
    return firstImageFromZip(buffer);
  }

  return null;
}

const isWebTemplate = (ext) => ext === 'html' || ext === 'htm';

function previewPayload (sample, converter) {
  return JSON.stringify({
    data      : readData(sample),
    convertTo : {
      formatName    : 'jpg',
      formatOptions : { PageRange: '1', Quality: 82 },
    },
    converter : converter,
  });
}

/**
 * The first LibreOffice conversion of a container spawns the worker, and the
 * connection is sometimes reset while it does. Getting it out of the way here
 * keeps the previews and the warmups clean.
 */
async function primeLibreOffice (options, sample, templateId) {
  log('  priming LibreOffice with one PDF render');

  await postUntilValid(options, {
    ...setupBudget(options),
    path     : renderPath(templateId),
    payload  : JSON.stringify({ data: readData(sample), convertTo: 'pdf', converter: 'L' }),
    label    : 'prime',
    validate : (body) => (looksValid(body, 'pdf') === true ? body : null),
  });
}

/** Renders the first page of every template as a JPG for the HTML report. */
async function generatePreviews (options, samples, templates) {
  fs.mkdirSync(PREVIEWS_DIR, { recursive: true });
  log(`\nGenerating ${samples.length} template preview${samples.length > 1 ? 's' : ''} (first page → JPG)`);

  const office = samples.find((sample) => isWebTemplate(sample.ext) === false
    && templates.get(sample.id).versionId !== null);

  if (office !== undefined) {
    try {
      await primeLibreOffice(options, office, templates.get(office.id).versionId);
    } catch (error) {
      log(`  ⚠ LibreOffice prime failed: ${error.message} (previews will still be retried)`);
    }
  }

  for (const sample of samples) {
    const { versionId, error } = templates.get(sample.id);

    if (versionId === null) {
      log(`  ⚠ ${sample.templateFile}: ${error}`);
      continue;
    }

    const dest = path.join(PREVIEWS_DIR, `${sample.templateFile}.jpg`);
    const legacy = path.join(PREVIEWS_DIR, `${sample.templateFile}.png`);
    // Chromium is only a fallback: LibreOffice handles HTML too, just less well
    const converters = isWebTemplate(sample.ext) === true ? ['L', 'C'] : ['L'];
    let saved = false;
    let lastError = 'no attempt';

    for (const converter of converters) {
      try {
        const jpeg = await postUntilValid(options, {
          ...setupBudget(options),
          path     : renderPath(versionId),
          payload  : previewPayload(sample, converter),
          label    : `${sample.templateFile} (${converter})`,
          validate : asJpeg,
        });

        fs.writeFileSync(dest, jpeg);

        if (fs.existsSync(legacy) === true) {
          fs.rmSync(legacy);
        }

        log(`  ${sample.templateFile} → ${path.relative(ROOT_DIR, dest)} (${(jpeg.length / 1024).toFixed(1)} KB, ${converter})`);
        saved = true;
        break;
      } catch (renderError) {
        lastError = renderError.message;
      }
    }

    if (saved === false) {
      log(`  ⚠ ${sample.templateFile}: ${lastError}`);
    }
  }
}

/* --------------------------------------------------------------------- k6 */

function runK6 (options, run, templateId, payloadPath, summaryPath) {
  const script = path.join(ROOT_DIR, 'bench', 'carbone-bench.js');

  const result = spawnSync('k6', ['run', script], {
    stdio : 'inherit',
    env   : {
      ...process.env,
      CARBONE_PAYLOAD  : payloadPath,
      CARBONE_SUMMARY  : summaryPath,
      CARBONE_URL      : renderUrl(options, templateId),
      CARBONE_LABEL    : run.label,
      CARBONE_VUS      : String(run.vus),
      CARBONE_DURATION : options.duration,
    },
  });

  // 99 = thresholds crossed, the measures are still valid
  if (result.status !== 0 && result.status !== 99) {
    throw new Error(`k6 exited with code ${result.status}`);
  }

  if (fs.existsSync(summaryPath) === false) {
    throw new Error(`k6 did not write its summary (${summaryPath})`);
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

  fs.rmSync(summaryPath, { force: true });

  return summary;
}

/* -------------------------------------------------------------------- main */

async function main () {
  const options = parseArgs(process.argv.slice(2));

  if (options.help === true) {
    log(HELP);
    return;
  }

  const samples = discoverSamples();
  let runs = buildMatrix({ samples, cpus: options.cpuList, vus: options.vuList });

  if (options.filter !== '') {
    const needle = options.filter.toLowerCase();
    runs = runs.filter((run) => `${run.id} ${run.label}`.toLowerCase().includes(needle));
  }

  if (runs.length === 0) {
    throw new Error('Nothing to run: no sample matches the filter');
  }

  if (options.docker === false && options.cpuList.length > 1) {
    throw new Error('--no-docker cannot restart Carbone between two factory counts: pass a single --cpus <n> matching the server you started');
  }

  log(`Carbone benchmark`);
  log(`  image ......... ${options.docker === true ? options.image : '(docker not managed)'}`);
  log(`  endpoint ...... ${renderUrl(options, ':templateVersionId')}`);
  log(`  factories ..... ${options.cpuList.join(', ')} CPU`);
  log(`  license ....... ${describeLicense(options)}`);
  log(`  load .......... ${options.vuList.join(', ')} VU during ${options.duration} per run`);
  log(`  samples ....... ${samples.length}`);
  log(`  runs .......... ${runs.length} (~${Math.ceil(runs.length * (parseDuration(options.duration) + options.cooldown + 5) / 60)} min)`);
  log('');
  for (const run of runs) {
    log(`  · ${run.label}`);
  }

  if (options.dryRun === true) {
    log('\n--dry-run: nothing executed.');
    return;
  }

  const k6Version = requireBinary('k6', ['version']);
  const dockerVersion = options.docker === true
    ? requireBinary('docker', ['version', '--format', '{{.Server.Version}}'])
    : '(not managed)';

  const resultsDir = path.resolve(ROOT_DIR, options.results);
  const tmpDir = path.join(ROOT_DIR, '.tmp');

  fs.mkdirSync(resultsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const meta = {
    startedAt : new Date().toISOString(),
    image     : options.docker === true ? options.image : 'unknown (docker not managed by the runner)',
    license   : describeLicense(options),
    vus       : options.vuList,
    duration  : options.duration,
    cpus      : options.cpuList,
    k6        : k6Version,
    docker    : dockerVersion,
    host      : {
      platform : `${os.platform()} ${os.release()} (${os.arch()})`,
      cpu      : os.cpus()[0]?.model ?? 'unknown',
      cores    : os.cpus().length,
      memory   : `${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`,
    },
  };

  if (options.docker === true) {
    process.on('SIGINT', () => {
      log('\nInterrupted, stopping the container...');
      removeContainer(options);
      process.exit(130);
    });
  }

  const results = [];
  let currentCpu = null;
  const warmed = new Set();
  const warmupKey = (run) => `${run.sampleId}|${run.converter}|${run.cpu}`;

  const used = usedSamples(samples, runs);
  let templates = new Map();
  let previewsDone = false;

  if (options.docker === false) {
    await waitForServer(options);
    templates = await uploadTemplates(options, used);
    await generatePreviews(options, used, templates);
    previewsDone = true;
  }

  try {
    for (const run of runs) {
      if (options.docker === true && run.cpu !== currentCpu) {
        startContainer(options, run.cpu);
        await waitForServer(options);

        currentCpu = run.cpu;

        // The new container starts with an empty template storage
        templates = await uploadTemplates(options, used);

        if (previewsDone === false) {
          await generatePreviews(options, used, templates);
          previewsDone = true;
        }
      }

      log(`\n${'─'.repeat(72)}`);
      log(`▶ ${run.label}   [${results.length + 1}/${runs.length}]`);
      log(`  template ${run.templateFile} · data ${run.dataFile ?? '{}'}`);

      const { versionId, error: uploadError } = templates.get(run.sampleId);
      const payload = buildPayload(run);
      const payloadPath = path.join(tmpDir, `${run.id}.json`);

      fs.writeFileSync(payloadPath, payload);

      // A template Carbone refused to store, or a warmup that never produced a
      // valid document, are the two reasons not to measure a run
      let skipReason = uploadError;

      if (versionId === null) {
        log(`  template not stored, nothing to render`);
      } else if (warmed.has(warmupKey(run)) === true) {
        log(`  warmup already done for this pipeline`);
      } else {
        skipReason = await warmup(options, run, payload, versionId);
      }

      if (skipReason !== null) {
        log(`  ⚠ skipped: ${skipReason}`);
        saveResult(resultsDir, results, { ...runMeta(run), skipped: true, error: skipReason });

        // The payload is kept on failure so the request can be replayed by hand
        if (options.docker === true) {
          const { state, detail } = containerState(options);

          // A dead server would turn every remaining run into a false negative
          if (state === 'exited') {
            throw new Error([
              `Carbone stopped while rendering "${run.label}" (${detail}).`,
              `Request: POST ${renderUrl(options, versionId ?? ':templateVersionId')} factories=${run.cpu}`,
              `Payload kept for replay: ${path.relative(ROOT_DIR, payloadPath)}`,
              '',
              `Container logs:\n${containerLogs(options)}`,
            ].join('\n'));
          }

          if (isNetworkError(skipReason) === true) {
            log(`  container still running, last logs:\n${indent(containerLogs(options))}`);
          }
        }

        continue;
      }

      warmed.add(warmupKey(run));

      const summary = runK6(options, run, versionId, payloadPath, path.join(tmpDir, `${run.id}.summary.json`));

      fs.rmSync(payloadPath, { force: true });

      saveResult(resultsDir, results, { ...runMeta(run), skipped: false, error: null, ...summary });

      await sleep(options.cooldown);
    }
  } finally {
    if (options.docker === true && options.keep === false) {
      removeContainer(options);
    }
  }

  meta.finishedAt = new Date().toISOString();

  // The index keeps every run present on disk, so running a subset with
  // --filter refines the report instead of truncating it
  fs.writeFileSync(path.join(resultsDir, 'index.json'), JSON.stringify({ meta, results: allResults(resultsDir) }, null, 2));

  log(`\n${'─'.repeat(72)}`);
  log(`${results.filter((result) => result.skipped === false).length}/${results.length} runs measured, results in ${path.relative(ROOT_DIR, resultsDir)}/`);

  generateReport({ resultsDir });
}

function saveResult (resultsDir, results, result) {
  results.push(result);
  fs.writeFileSync(path.join(resultsDir, `${result.id}.json`), JSON.stringify(result, null, 2));
}

function allResults (resultsDir) {
  return fs.readdirSync(resultsDir)
    .filter((file) => file.endsWith('.json') === true && file !== 'index.json')
    .map((file) => JSON.parse(fs.readFileSync(path.join(resultsDir, file), 'utf8')));
}

function describeLicense (options) {
  const variable = LICENSE_VARS.find((name) => (process.env[name] ?? '') !== '');

  if (options.licenseFile !== '') {
    return `file ${options.licenseFile}`;
  }
  if (variable !== undefined) {
    return `$${variable} (forwarded to the container)`;
  }

  return 'none (community edition)';
}

function runMeta (run) {
  return {
    id            : run.id,
    label         : run.label,
    vendor        : run.vendor,
    sample        : run.sampleName,
    family        : run.family,
    pages         : run.pages,
    templateFile  : run.templateFile,
    templateExt   : run.templateExt,
    dataFile      : run.dataFile,
    cpu           : run.cpu,
    vus           : run.vus,
    convertTo     : run.convertTo,
    converter     : run.converter,
    converterName : run.converterName,
    group         : run.group,
    groupLabel    : run.groupLabel,
  };
}

/** '30s' -> 30, '2m' -> 120 */
function parseDuration (duration) {
  const match = /^([\d.]+)(ms|s|m|h)?$/.exec(duration.trim());

  if (match === null) {
    return 30;
  }

  const value = Number(match[1]);
  const factors = { ms: 0.001, s: 1, m: 60, h: 3600 };

  return value * (factors[match[2] || 's']);
}

function fail (error) {
  // A plain Error is a failure we report on purpose, anything else is a bug:
  // show the stack so it can be fixed instead of guessed
  const details = error instanceof Error && error.name === 'Error'
    ? error.message
    : (error?.stack || String(error));

  process.stderr.write(`\n✖ ${details}\n`);
  process.exit(1);
}

process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

main().catch(fail);
