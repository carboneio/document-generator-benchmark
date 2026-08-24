/**
 * Sample discovery and benchmark matrix definition.
 *
 * A "sample" is a template file in `samples/` optionally paired with a JSON data
 * file of the same basename (template_invoice.docx + template_invoice.json).
 *
 * For every sample, the matrix contains:
 *   - one run without conversion (Carbone only merges the data into the template)
 *   - one run per relevant PDF converter:
 *       DOCX templates   -> LibreOffice (L), OnlyOffice (O) and Carbone ICE (I)
 *       other office     -> LibreOffice (L) and OnlyOffice (O)
 *       web templates    -> Chromium (C)
 * ... each of them repeated for every requested number of Carbone factories (CPU)
 * and every requested concurrency (VUs).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(HERE, '..');
export const SAMPLES_DIR = path.join(ROOT_DIR, 'samples');

export const VENDOR = 'Carbone';

export const CONVERTER_NAMES = { I: 'Carbone ICE', L: 'LibreOffice', O: 'OnlyOffice', C: 'Chromium' };

/** `incoice_simple_100p` -> { family: 'incoice_simple', pages: 100 } */
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

export function pdfConverters (ext) {
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

/** `template_incoice_simple.docx` -> `incoice_simple` */
function sampleName (basename) {
  return basename.replace(/^(template|sample)[-_]/i, '') || basename;
}

export function discoverSamples (dir = SAMPLES_DIR) {
  if (fs.existsSync(dir) === false) {
    throw new Error(`Samples directory not found: ${dir}`);
  }

  const samples = [];

  for (const filename of fs.readdirSync(dir).sort()) {
    // Skip dotfiles, LibreOffice lock files and other editor leftovers
    if (filename.startsWith('.') === true || filename.startsWith('~') === true) {
      continue;
    }

    const ext = path.extname(filename).slice(1).toLowerCase();

    if (TEMPLATE_EXT.has(ext) === false) {
      continue;
    }

    const basename = path.basename(filename, path.extname(filename));
    const dataPath = path.join(dir, `${basename}.json`);
    const hasData = fs.existsSync(dataPath);
    const name = sampleName(basename);
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
      dataFile     : hasData === true ? `${basename}.json` : null,
      dataPath     : hasData === true ? dataPath : null,
    });
  }

  return samples;
}

function describe (sample, converter, cpu, vus) {
  const from = sample.ext.toUpperCase();
  const to = converter === null ? from : 'PDF';
  const how = converter === null ? 'merge only' : CONVERTER_NAMES[converter];

  return `${sample.name} ${from} → ${to} (${how}) / ${cpu} CPU / ${vus} VU`;
}

/**
 * @param  {Object}  options.samples  output of discoverSamples()
 * @param  {Array}   options.cpus     list of factory counts, ex: [1, 4]
 * @param  {Array}   options.vus      list of concurrency levels, ex: [5, 20, 100]
 * @return {Array}   one entry per benchmark run, grouped by CPU then sample
 */
export function buildMatrix ({ samples, cpus, vus = [5] }) {
  const runs = [];

  for (const cpu of cpus) {
    for (const sample of samples) {
      const converters = [null, ...pdfConverters(sample.ext)];

      for (const converter of converters) {
        const convertTo = converter === null ? null : 'pdf';
        const suffix = converter === null ? 'native' : `pdf-${converter}`;

        for (const vu of vus) {
          runs.push({
            id            : `${sample.id}_${suffix}_${cpu}cpu_${vu}vu`,
            label         : describe(sample, converter, cpu, vu),
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
            cpu           : cpu,
            vus           : vu,
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
  const vus = (process.argv[3] || '10').split(',').map(Number);
  const samples = discoverSamples();
  const runs = buildMatrix({ samples, cpus, vus });

  console.log(`${samples.length} samples found in ${SAMPLES_DIR}`);
  for (const sample of samples) {
    console.log(`  - ${sample.templateFile} + ${sample.dataFile ?? '(no data, {} is used)'}`);
  }
  console.log(`\n${runs.length} runs planned:`);
  for (const run of runs) {
    console.log(`  - ${run.id.padEnd(38)} ${run.label}`);
  }
}
