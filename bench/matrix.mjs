/**
 * Sample discovery and benchmark matrix definition.
 *
 * A "sample" is a template file in `samples/` optionally paired with a JSON data
 * file of the same basename (template_invoice.docx + template_invoice.json).
 *
 * A template can also be paired with a bigger dataset, named after the number of
 * pages the generated document has: `template_invoice_213p.json` produces a
 * 213 page document out of the very same template. Each dataset becomes its own
 * sample, and the report turns the big one into pages per second
 * (`bench/grow-sample.mjs` builds them).
 *
 * For every sample, the matrix contains:
 *   - one run without conversion (Carbone only merges the data into the template)
 *   - one run per relevant PDF converter:
 *       DOCX templates   -> LibreOffice (L), OnlyOffice (O) and Carbone ICE (I)
 *       other office     -> LibreOffice (L) and OnlyOffice (O)
 *       web templates    -> Chromium (C)
 * ... each of them repeated for every profile below, except a big document,
 * which is only measured one at a time.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(HERE, '..');
const SAMPLES_DIR = path.join(ROOT_DIR, 'samples');

const VENDOR = 'Carbone';

export const CONVERTER_NAMES = { I: 'Carbone ICE', L: 'LibreOffice', O: 'OnlyOffice', C: 'Chromium' };

/** `invoice_simple_213p` -> { family: 'invoice_simple', pages: 213 } */
export function parseSampleIdentity (name) {
  const match = /_(\d+)p(?:ages)?$/i.exec(name);

  if (match === null) {
    return { family: name, pages: 1 };
  }

  return { family: name.slice(0, match.index) || name, pages: Number(match[1]) };
}

export const MIME_TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  txt: 'text/plain',
  xml: 'application/xml',
  pdf: 'application/pdf',
};

/** Templates converted to PDF by LibreOffice or OnlyOffice. */
const OFFICE_EXT = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);
/** Templates converted to PDF by Chromium. */
const WEB_EXT = new Set(['html', 'htm', 'md', 'txt', 'xml']);

export const TEMPLATE_EXT = new Set([...OFFICE_EXT, ...WEB_EXT]);

function pdfConverters (ext) {
  // Carbone ICE (I) is a DOCX → PDF engine only, available since 5.14.0
  if (ext === 'docx') {
    return ['L', 'O', 'I'];
  }
  if (OFFICE_EXT.has(ext)) {
    return ['L', 'O'];
  }
  if (WEB_EXT.has(ext)) {
    return ['C'];
  }
  return [];
}

/** `template_invoice_simple.docx` -> `invoice_simple` */
function sampleName (basename) {
  return basename.replace(/^(template|sample)[-_]/i, '') || basename;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Datasets of one template, smallest document first:
 * `template_invoice.json` (1 page) then `template_invoice_150p.json` (150 pages).
 *
 * @return {Array} `[null]` when the template has no dataset at all
 */
function dataFilesOf (filenames, basename) {
  const variant = new RegExp(`^${escapeRegExp(basename)}_\\d+p\\.json$`, 'i');
  const files = filenames.filter((filename) => filename === `${basename}.json` || variant.test(filename) === true);

  if (files.length === 0) {
    return [null];
  }

  return files.sort((a, b) => parseSampleIdentity(path.basename(a, '.json')).pages
    - parseSampleIdentity(path.basename(b, '.json')).pages);
}

export function discoverSamples (dir = SAMPLES_DIR) {
  if (fs.existsSync(dir) === false) {
    throw new Error(`Samples directory not found: ${dir}`);
  }

  // Skip dotfiles, LibreOffice lock files and other editor leftovers
  const filenames = fs.readdirSync(dir)
    .filter((filename) => filename.startsWith('.') === false && filename.startsWith('~') === false)
    .sort();
  const samples = [];

  for (const filename of filenames) {
    const ext = path.extname(filename).slice(1).toLowerCase();

    if (TEMPLATE_EXT.has(ext) === false) {
      continue;
    }

    const basename = path.basename(filename, path.extname(filename));

    for (const dataFile of dataFilesOf(filenames, basename)) {
      // The dataset drives the identity: one template plus three datasets is
      // three samples, each generating a document of a different size
      const name = sampleName(dataFile === null ? basename : path.basename(dataFile, '.json'));
      const { family, pages } = parseSampleIdentity(name);

      samples.push({
        id           : `${name}_${ext}`,
        name         : name,
        family       : family,
        pages        : pages,
        ext          : ext,
        mime         : MIME_TYPES[ext] || 'application/octet-stream',
        templateFile : filename,
        templatePath : path.join(dir, filename),
        dataFile     : dataFile,
        dataPath     : dataFile === null ? null : path.join(dir, dataFile),
      });
    }
  }

  return samples;
}

/**
 * What is measured, and why twice.
 *
 * `solo` answers "how long does Carbone need to produce this document": one
 * request at a time on a single factory, so nothing ever waits. It is the
 * regime of the per-document times and of the pages per second.
 * `load` answers "how many documents does the server deliver": five requests at
 * the same time on four factories, enough to keep them busy without turning the
 * measure into a queue length.
 *
 * Every run stops after `renders` documents per virtual user, `maxDuration`
 * being the safety net for the slowest pipelines: the same amount of work is
 * measured everywhere instead of the same amount of time.
 */
export const PROFILES = {
  solo : { vus: 1, renders: 10, maxDuration: '10m' },
  load : { vus: 5, renders: 100, maxDuration: '60s' },
};

/**
 * Above that many pages, a document is only measured one at a time and only a
 * few times: three renders of a two hundred page report already give a stable
 * median, where ten of them would cost minutes for nothing.
 */
export const BIG_PAGES = 100;
export const BIG_RENDERS = 3;

/**
 * A single render slower than that is not worth waiting for: the run stops on
 * the first one and the report shows it as out of scale.
 */
export const RENDER_TIMEOUT = '120s';

/**
 * One entry per k6 run configuration, ordered by factory count so that the
 * runner restarts the container once per count — two starts for `[1, 4]`.
 *
 * The smallest count carries the one-at-a-time run and nothing else: its
 * throughput is read from that same run, which keeps the campaign to one k6 run
 * per factory count.
 *
 * @param  {Array}   options.cpus  factory counts to measure, ex: [1, 4]
 * @param  {Object}  options.solo  overrides of PROFILES.solo, null to skip it
 * @param  {Object}  options.load  overrides of PROFILES.load, `vus` may be a list
 */
export function buildProfiles ({ cpus, solo = {}, load = {} }) {
  const counts = [...new Set(cpus)].sort((a, b) => a - b);
  const asked = (Array.isArray(load.vus) === true ? load.vus : [load.vus])
    .filter((value) => Number.isFinite(value) === true);
  const vuList = asked.length > 0 ? asked : [PROFILES.load.vus];
  const profiles = [];
  const seen = new Set();

  for (const cpu of counts) {
    const wanted = [];
    // Timing a single document needs one factory: the other three would sit
    // idle and measure exactly the same thing
    const alone = cpu === counts[0] && solo !== null;

    if (alone === true) {
      wanted.push({ id: 'solo', ...PROFILES.solo, ...solo, cpu });
    }

    // A single factory count has to carry both measures, since there is no
    // second pass to read the throughput from
    if (alone === false || counts.length === 1) {
      for (const vus of vuList) {
        wanted.push({ id: 'load', ...PROFILES.load, ...load, vus, cpu });
      }
    }

    for (const profile of wanted) {
      const key = `${profile.cpu}|${profile.vus}`;

      if (seen.has(key) === false) {
        seen.add(key);
        profiles.push(profile);
      }
    }
  }

  return profiles;
}

function describe (sample, converter, profile) {
  const from = sample.ext.toUpperCase();
  const to = converter === null ? from : 'PDF';
  const how = converter === null ? 'merge only' : CONVERTER_NAMES[converter];
  const load = profile.id === 'solo' ? '1 VU (no queue)' : `${profile.vus} VU`;

  return `${sample.name} ${from} → ${to} (${how}) / ${profile.cpu} CPU / ${load}`;
}

/** Big documents are only measured one at a time, and only three times. */
const isBig = (sample) => sample.pages > BIG_PAGES;

/**
 * @param  {Object}  options.samples   output of discoverSamples()
 * @param  {Array}   options.profiles  output of buildProfiles()
 * @param  {Number}  options.warmup    warmup renders, skipped on big documents
 * @return {Array}   one entry per benchmark run, grouped by CPU then sample
 */
export function buildMatrix ({ samples, profiles, warmup = 3 }) {
  const runs = [];

  for (const profile of profiles) {
    for (const sample of samples) {
      // Under load a big document would only measure the queue, and each of its
      // renders costs seconds: the per-document time is what it is here for
      if (isBig(sample) === true && profile.id !== 'solo') {
        continue;
      }

      const converters = [null, ...pdfConverters(sample.ext)];

      for (const converter of converters) {
        const convertTo = converter === null ? null : 'pdf';
        const suffix = converter === null ? 'native' : `pdf-${converter}`;

        runs.push({
          id            : `${sample.id}_${suffix}_${profile.cpu}cpu_${profile.vus}vu`,
          label         : describe(sample, converter, profile),
          vendor        : VENDOR,
          sampleId      : sample.id,
          sampleName    : sample.name,
          family        : sample.family,
          pages         : sample.pages,
          templateFile  : sample.templateFile,
          templatePath  : sample.templatePath,
          templateExt   : sample.ext,
          mime          : sample.mime,
          dataFile      : sample.dataFile,
          dataPath      : sample.dataPath,
          profile       : profile.id,
          cpu           : profile.cpu,
          vus           : profile.vus,
          renders       : isBig(sample) === true ? BIG_RENDERS : profile.renders,
          maxDuration   : profile.maxDuration,
          timeout       : RENDER_TIMEOUT,
          // Warming up a document that takes ten seconds costs more than the
          // measure itself
          warmup        : isBig(sample) === true ? 0 : warmup,
          convertTo     : convertTo,
          outputExt     : convertTo === null ? sample.ext : convertTo,
          converter     : converter,
          converterName : converter === null ? 'none' : CONVERTER_NAMES[converter],
          group         : converter === null ? 'merge' : converter,
          groupLabel    : converter === null ? 'Merge only (no conversion)' : `PDF via ${CONVERTER_NAMES[converter]}`,
        });
      }
    }
  }

  return runs;
}

/** JSON dataset of a sample or a run, `{}` when there is no `.json` file. */
export function readData ({ dataPath }) {
  return dataPath === null ? {} : JSON.parse(fs.readFileSync(dataPath, 'utf8'));
}

/**
 * Exact JSON body sent to `POST /render/:templateVersionId`, built once and
 * reused by k6. The template itself is uploaded beforehand with
 * `POST /template`, so a render only carries the dataset.
 */
export function buildPayload (run) {
  const body = { data: readData(run) };

  if (run.convertTo !== null) {
    body.convertTo = run.convertTo;
    body.converter = run.converter;
  }

  return JSON.stringify(body);
}

/** Cheap sanity check on a generated document, used during warmup. */
export function looksValid (buffer, outputExt) {
  if (buffer.length < 64) {
    return false;
  }

  const head = buffer.subarray(0, 5).toString('latin1');

  if (outputExt === 'pdf') {
    return head.startsWith('%PDF');
  }
  if (outputExt === 'jpg' || outputExt === 'jpeg') {
    return buffer[0] === 0xFF && buffer[1] === 0xD8;
  }
  if (OFFICE_EXT.has(outputExt) === true) {
    return head.startsWith('PK');
  }

  return true;
}

// `node bench/matrix.mjs [cpus] [vus]` prints the planned runs
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cpus = (process.argv[2] || '1,4').split(',').map(Number);
  const vus = (process.argv[3] || String(PROFILES.load.vus)).split(',').map(Number);
  const samples = discoverSamples();
  const runs = buildMatrix({ samples, profiles: buildProfiles({ cpus, load: { vus } }) });

  console.log(`${samples.length} samples found in ${SAMPLES_DIR}`);
  for (const sample of samples) {
    const data = sample.dataFile ?? '(no data, {} is used)';

    console.log(`  - ${sample.templateFile.padEnd(32)} + ${data.padEnd(36)} ${sample.pages} page${sample.pages > 1 ? 's' : ''}`);
  }
  console.log(`\n${runs.length} runs planned:`);
  for (const run of runs) {
    console.log(`  - ${run.id.padEnd(38)} ${run.label}`);
  }
}
