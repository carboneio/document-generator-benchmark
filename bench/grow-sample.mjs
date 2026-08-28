#!/usr/bin/env node
/**
 * Builds the multi-page datasets of `samples/`, to measure Carbone on documents
 * of several hundred pages without hand-writing the data.
 *
 * Given a number of pages, it grows one array of an existing dataset until the
 * generated document has *at least* that many pages: entries are added out of
 * the first one, keeping the same shape and types with randomized content
 * (images become mono-color pictures), then Carbone renders the PDF and its
 * pages are counted. The exact count does not matter, since the report turns it
 * into pages per second — only the name has to tell the truth.
 *
 * The result is written next to the original as `<sample>_<pages>p.json`, the
 * name the benchmark reads the page count from.
 *
 *   node bench/grow-sample.mjs samples/template_invoice_simple.json 200 d.products
 *   node bench/grow-sample.mjs samples/template_qrcode.json 200 d
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { CONVERTER_NAMES, MIME_TYPES, ROOT_DIR, TEMPLATE_EXT } from './matrix.mjs';

const HELP = `
Usage: node bench/grow-sample.mjs <sample.json> <pages> <array> [options]

  <sample.json>  dataset to grow, ex: samples/template_invoice_simple.json
  <pages>        how many pages the generated document must have at least
  <array>        array to grow, ex: d.products — use d when the dataset is an array

  --template <file>   template to render      (default the one next to the dataset)
  --converter <code>  I, L, O or C            (default I for office, C for web)
  --port <port>       Carbone port            (default 4000)
  --out <file>        output file             (default <sample>_<pages>p.json)
  -h, --help          this help

Carbone must be running: the page count of a document can only be known by
generating it. Start one with:
  docker run --rm -p 4000:4000 carbone/carbone-ee:full-5.14.0 webserver -s -f 4
`;

const log = (message = '') => process.stdout.write(`${message}\n`);

function parseArgs (argv) {
  const options = {
    sample    : '',
    pages     : 0,
    array     : '',
    template  : '',
    converter : '',
    port      : Number(process.env.CARBONE_PORT || 4000),
    out       : '',
    help      : false,
  };
  const positional = [];

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
      case '--template':  options.template = next(); break;
      case '--converter': options.converter = next(); break;
      case '--port':      options.port = Number(next()); break;
      case '--out':       options.out = next(); break;
      case '-h':
      case '--help':      options.help = true; break;
      default:
        if (arg.startsWith('-') === true) {
          throw new Error(`Unknown option: ${arg}`);
        }
        positional.push(arg);
    }
  }

  if (options.help === true) {
    return options;
  }

  if (positional.length !== 3) {
    throw new Error(`Expected 3 arguments (<sample.json> <pages> <array>), got ${positional.length}.${HELP}`);
  }

  options.sample = positional[0];
  options.pages = Number(positional[1]);
  options.array = positional[2];

  if (Number.isInteger(options.pages) === false || options.pages < 1) {
    throw new Error(`<pages> must be a positive integer, got "${positional[1]}"`);
  }

  return options;
}

/* ------------------------------------------------------------------ dataset */

/** `d.products` -> ['products'], `d` -> [], `d.lines[0].items` -> ['lines','0','items'] */
function parsePath (expression) {
  const segments = String(expression).replace(/\[(\d+)\]/g, '.$1').split('.').filter((part) => part !== '');

  // `d` is the dataset itself in a Carbone template, `c` the complement
  if (segments[0] === 'd' || segments[0] === 'c') {
    segments.shift();
  }

  return segments;
}

function resolveArray (data, expression) {
  let node = data;

  for (const segment of parsePath(expression)) {
    if (node === null || typeof node !== 'object') {
      throw new Error(`"${expression}" cannot be reached: "${segment}" has no parent object in the dataset`);
    }

    node = node[segment];
  }

  if (Array.isArray(node) === false) {
    const type = node === null ? 'null' : typeof node;
    const found = node === undefined ? 'nothing' : `${type === 'object' ? 'an' : 'a'} ${type}`;

    throw new Error(`"${expression}" is ${found} in the dataset, an array is required`);
  }

  return node;
}

/* -------------------------------------------------------------- randomizing */

const between = (min, max) => min + Math.random() * (max - min);
const pick = (characters) => characters[Math.floor(Math.random() * characters.length)];

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';

/**
 * Same length, same case, same punctuation, different content: the merged
 * document keeps the layout of the original one.
 */
function scramble (text) {
  return [...text].map((character) => {
    if (/[a-z]/.test(character) === true) {
      return pick(LETTERS);
    }
    if (/[A-Z]/.test(character) === true) {
      return pick(LETTERS).toUpperCase();
    }
    if (/[0-9]/.test(character) === true) {
      return pick(DIGITS);
    }

    return character;
  }).join('');
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?)?$/;

/**
 * Another day, written exactly like the original one: same separator, same
 * precision, same timezone. Template formatters keep working.
 */
function randomDate (text) {
  const source = new Date(text);
  const base = Number.isNaN(source.getTime()) === true ? Date.now() : source.getTime();
  const iso = new Date(base + Math.round(between(-200, 200)) * 86400000).toISOString();

  if (text.length <= 10) {
    return iso.slice(0, 10);
  }

  const zone = text.endsWith('Z') === true ? 'Z' : '';
  // Width of the time part of the original: 5 (HH:MM), 8 (with seconds), 12 (with milliseconds)
  const width = text.length - zone.length - 11;

  return `${iso.slice(0, 10)}${text[10]}${iso.slice(11, Math.min(11 + width, 23))}${zone}`;
}

const randomColor = () => `#${[0, 0, 0].map(() => Math.floor(between(0, 256)).toString(16).padStart(2, '0')).join('')}`;

/* ------------------------------------------------------------------- images */

const CRC_TABLE = Array.from({ length: 256 }, (unused, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit++) {
    value = (value & 1) === 1 ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
  }

  return value >>> 0;
});

function crc32 (buffer) {
  let crc = 0xFFFFFFFF;

  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk (type, data) {
  const header = Buffer.alloc(4);
  const name = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);

  header.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));

  return Buffer.concat([header, name, data, crc]);
}

/** Solid color PNG, a few hundred bytes whatever its size. */
function monoPng (width, height, [red, green, blue]) {
  const header = Buffer.alloc(13);

  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;  // 8 bits per channel
  header[9] = 2;  // truecolor RGB

  const row = Buffer.alloc(1 + width * 3);

  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = red;
    row[2 + x * 3] = green;
    row[3 + x * 3] = blue;
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const IMAGE_SIDE = 200;

/**
 * A random mono-color picture, as a data URI Carbone can embed. SVG sources stay
 * SVG, everything else becomes a PNG: office templates size the frame
 * themselves, so the source format and its pixel size do not change the layout.
 */
function randomImage (dataUri) {
  const channels = [Math.floor(between(0, 256)), Math.floor(between(0, 256)), Math.floor(between(0, 256))];

  if (/^data:image\/svg\+xml/i.test(dataUri) === true) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_SIDE}" height="${IMAGE_SIDE}">`
      + `<rect width="100%" height="100%" fill="rgb(${channels.join(',')})"/></svg>`;

    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }

  return `data:image/png;base64,${monoPng(IMAGE_SIDE, IMAGE_SIDE, channels).toString('base64')}`;
}

const isImage = (text) => /^data:image\//i.test(text);

/* ---------------------------------------------------------------- the model */

/** Whether an entry carries a picture, only to report it on the console. */
const hasImage = (value) => {
  if (typeof value === 'string') {
    return isImage(value);
  }

  return value !== null && typeof value === 'object' && Object.values(value).some(hasImage);
};

function randomString (text) {
  if (isImage(text) === true) {
    return randomImage(text);
  }
  if (ISO_DATE.test(text) === true) {
    return randomDate(text);
  }
  if (/^#[0-9a-f]{3,8}$/i.test(text) === true) {
    return randomColor();
  }

  return scramble(text);
}

/** Same magnitude and same number of decimals as the model value. */
function randomNumber (value) {
  const decimals = (String(value).split('.')[1] || '').length;
  const size = Math.max(Math.abs(value), 1);
  const drawn = between(size * 0.4, size * 1.6) * (value < 0 ? -1 : 1);

  return Number(drawn.toFixed(Math.min(decimals, 6)));
}

/** A copy of `model` with the same shape and types, but randomized leaves. */
function randomLike (model) {
  if (Array.isArray(model) === true) {
    return model.map(randomLike);
  }
  if (model !== null && typeof model === 'object') {
    return Object.fromEntries(Object.entries(model).map(([key, value]) => [key, randomLike(value)]));
  }
  if (typeof model === 'string') {
    return randomString(model);
  }
  if (typeof model === 'number') {
    return randomNumber(model);
  }
  if (typeof model === 'boolean') {
    return Math.random() < 0.5;
  }

  return model;
}

/* ------------------------------------------------------------------ carbone */

function postJson (port, urlPath, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(payload, 'utf8');

    const request = http.request({
      host    : '127.0.0.1',
      port    : port,
      method  : 'POST',
      path    : urlPath,
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

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Carbone did not answer within ${Math.round(timeoutMs / 1000)}s`));
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function post (port, urlPath, payload, timeoutMs) {
  const { status, body } = await postJson(port, urlPath, payload, timeoutMs).catch((error) => {
    if (/ECONNREFUSED|ECONNRESET|socket hang up|did not answer/i.test(error.message) === false) {
      throw error;
    }

    throw new Error(`Carbone is not answering on port ${port} (${error.message}). Start one with:\n`
      + `  docker run --rm -p ${port}:4000 carbone/carbone-ee:full-5.14.0 webserver -s -f 4`);
  });

  if (status !== 200) {
    throw new Error(`POST ${urlPath} → HTTP ${status} ${body.toString('utf8').slice(0, 300)}`);
  }

  return body;
}

/** The template the dataset belongs to: `<basename>.docx` for `<basename>_150p.json`. */
function templateOf (samplePath) {
  const dir = path.dirname(samplePath);
  const basename = path.basename(samplePath, '.json').replace(/_\d+p$/i, '');
  const candidates = fs.readdirSync(dir)
    .filter((filename) => path.basename(filename, path.extname(filename)) === basename)
    .filter((filename) => TEMPLATE_EXT.has(path.extname(filename).slice(1).toLowerCase()) === true);

  if (candidates.length === 0) {
    throw new Error(`No template found next to ${path.basename(samplePath)} (looked for ${basename}.docx, ${basename}.html, …)`);
  }

  // DOCX first: it is the only format Carbone ICE converts
  return path.join(dir, candidates.find((filename) => filename.endsWith('.docx') === true) ?? candidates[0]);
}

/**
 * Number of pages of a PDF: the page objects when they are readable, the page
 * tree count otherwise. `null` when neither can be trusted.
 */
function countPdfPages (pdf) {
  const text = pdf.toString('latin1');
  const pages = text.match(/\/Type\s*\/Page(?!\w)/g);

  if (pages !== null) {
    return pages.length;
  }

  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((match) => Number(match[1]));

  return counts.length > 0 ? Math.max(...counts) : null;
}

/** Uploads the template once, every render of the search then reuses its id. */
async function uploadTemplate (port, templatePath) {
  const ext = path.extname(templatePath).slice(1).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  // `template` must be the last field of the body
  const answer = await post(port, '/template', JSON.stringify({
    versioning : true,
    template   : `data:${mime};base64,${fs.readFileSync(templatePath).toString('base64')}`,
  }), 60000);

  const body = JSON.parse(answer.toString('utf8'));
  const versionId = body?.data?.versionId ?? body?.data?.templateId;

  if (typeof versionId !== 'string' || versionId === '') {
    throw new Error(`POST /template did not return a version id: ${answer.toString('utf8').slice(0, 200)}`);
  }

  return versionId;
}

const renderPdf = (port, versionId, converter, data) => post(port, `/render/${versionId}?download=true`, JSON.stringify({
  data      : data,
  convertTo : 'pdf',
  converter : converter,
}), 600000);

/* --------------------------------------------------------------------- grow */

/**
 * Resizes the array in place, always to the same content for a given size: the
 * original entries first, then generated ones drawn once and kept. The page
 * count is then a pure function of the size.
 */
function resizer (array, model) {
  const original = array.slice();
  const generated = [];

  return (size) => {
    while (original.length + generated.length < size) {
      generated.push(randomLike(model));
    }

    array.length = 0;

    for (let index = 0; index < size; index++) {
      array.push(index < original.length ? original[index] : generated[index - original.length]);
    }
  };
}

/**
 * Entries to try next: how many the last render suggests, plus 5 % so that a
 * slightly super-linear template does not need one more round trip. Growing by
 * at least a quarter keeps the loop short when the prediction barely moves.
 */
function nextSize (size, pages, target) {
  const predicted = Math.ceil(size * (target / Math.max(pages, 1)) * 1.05);

  return Math.max(predicted, Math.ceil(size * 1.25), size + 1);
}

const MAX_RENDERS = 8;

/**
 * Grows the array until the document has at least `options.pages` pages, and
 * returns the last render — the only PDF kept, a several hundred page document
 * being heavy.
 */
async function grow (options, context) {
  const { resize, data, versionId, converter } = context;
  let size = options.pages;

  for (let render = 1; render <= MAX_RENDERS; render++) {
    resize(size);

    const pdf = await renderPdf(options.port, versionId, converter, data);
    const pages = countPdfPages(pdf);

    if (pages === null) {
      throw new Error('The page count of the generated PDF is unreadable, cannot grow the dataset');
    }

    log(`  ${String(size).padStart(6)} entries → ${pages} page${pages === 1 ? '' : 's'}`
      + `${pages >= options.pages ? '  ✔' : ''}`);

    if (pages >= options.pages) {
      return { size: size, pages: pages, pdf: pdf, renders: render };
    }

    size = nextSize(size, pages, options.pages);
  }

  throw new Error(`${options.pages} pages not reached in ${MAX_RENDERS} renders.`
    + ' Does the template really repeat the array it was given?');
}

/* -------------------------------------------------------------------- main */

async function main () {
  const options = parseArgs(process.argv.slice(2));

  if (options.help === true) {
    log(HELP);
    return;
  }

  const samplePath = path.resolve(options.sample);

  if (fs.existsSync(samplePath) === false) {
    throw new Error(`Dataset not found: ${samplePath}`);
  }

  const data = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const array = resolveArray(data, options.array);
  const originalSize = array.length;

  if (originalSize === 0) {
    throw new Error(`"${options.array}" is empty: at least one entry is needed as the model`);
  }

  const templatePath = options.template === '' ? templateOf(samplePath) : path.resolve(options.template);
  const ext = path.extname(templatePath).slice(1).toLowerCase();
  const converter = options.converter || (ext === 'docx' ? 'I' : 'C');

  log(`Growing "${options.array}" of ${path.basename(samplePath)} until the document has at least ${options.pages} pages`);
  log(`  ${path.basename(templatePath)} → PDF with ${CONVERTER_NAMES[converter] ?? converter}, Carbone on port ${options.port}\n`);

  const context = {
    data      : data,
    resize    : resizer(array, array[0]),
    versionId : await uploadTemplate(options.port, templatePath),
    converter : converter,
  };
  const grown = await grow(options, context);

  // The name carries the page count of the document, which the report divides
  // the throughput by: it has to be the real one
  const outPath = options.out === ''
    ? path.join(path.dirname(samplePath), `${path.basename(samplePath, '.json').replace(/_\d+p$/i, '')}_${grown.pages}p.json`)
    : path.resolve(options.out);
  const pdfPath = path.join(ROOT_DIR, '.tmp', `${path.basename(outPath, '.json')}.pdf`);

  fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
  fs.writeFileSync(pdfPath, grown.pdf);

  const generated = Math.max(0, grown.size - originalSize);

  log('');
  log(`✔ ${grown.pages} pages with ${grown.size} entries, in ${grown.renders} render${grown.renders === 1 ? '' : 's'}`);
  log(`  ${generated} entr${generated === 1 ? 'y' : 'ies'} randomized out of the first one`
    + `${hasImage(array[0]) === true ? ', images replaced by mono-color pictures' : ''}`);
  log(`  ${path.relative(ROOT_DIR, outPath)} — ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB`);
  log(`  ${path.relative(ROOT_DIR, pdfPath)} — ${(grown.pdf.length / 1024 / 1024).toFixed(2)} MB, open it to check the result`);
}

function fail (error) {
  const details = error instanceof Error && error.name === 'Error' ? error.message : (error?.stack || String(error));

  process.stderr.write(`\n✖ ${details}\n`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(fail);
}
