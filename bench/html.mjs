/**
 * Static HTML report. One self-contained page per campaign.
 *
 * The data model is vendor-agnostic: each measured run has a `vendor`
 * (today always "Carbone"). A later phase can add Gotenberg / others as
 * extra bars in the same per-template chart without changing the layout.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSampleIdentity } from './matrix.mjs';

const DOCS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');

const ENGINE = {
  merge : { id: 'merge', label: 'Merge only', short: 'Merge only', color: '#A644C5' },
  I     : { id: 'I', label: 'Carbone ICE', short: 'Carbone ICE', color: '#A644C5' },
  L     : { id: 'L', label: 'LibreOffice', short: 'LibreOffice', color: '#ff7f0e' },
  O     : { id: 'O', label: 'OnlyOffice', short: 'OnlyOffice', color: '#2ca02c' },
  C     : { id: 'C', label: 'Chromium', short: 'Chromium', color: '#358BBA' },
};

const sameFormat = (ext) => `${ext} → ${ext}`;
const toPdf = (ext) => `${ext} → PDF`;
const formatLabel = (ext) => {
  const value = String(ext || '').toUpperCase();

  if (value === 'HTM') {
    return 'HTML';
  }

  return value || 'FILE';
};

const FAMILY_DISPLAY = {
  chart  : 'financial_chart',
  qrcode : 'ticket_qrcode',
};

function displayName (family) {
  return FAMILY_DISPLAY[family] || family;
}

const PDF_ORDER = { docx: ['I', 'L', 'O'], html: ['C'], htm: ['C'] };

const escape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const pagesLabel = (pages) => (pages === 1 ? '1 page' : `${pages} pages`);

function slug (value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'template';
}

function listOf (value) {
  if (Array.isArray(value) === true) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }

  return [value];
}

function engineOf (row) {
  const code = row.raw?.converter ?? row.group;
  const isPdf = (row.output || '').toUpperCase() === 'PDF' || row.raw?.convertTo === 'pdf';

  if (isPdf === false && (row.group === 'merge' || code === null || code === undefined)) {
    return ENGINE.merge;
  }

  return ENGINE[code] || ENGINE[row.group] || {
    id    : code || row.group,
    label : row.converter || row.vendor || 'Unknown',
    short : row.converter || row.vendor || 'Unknown',
    color : '#888888',
  };
}

/** Keep only successful runs that belong to the latest campaign (profiles). */
export function filterCampaign (rows, meta) {
  const vus = listOf(meta?.vus).map(Number).filter(Boolean);
  const cpus = listOf(meta?.cpus).map(Number).filter(Boolean);
  // A campaign measures a few (CPU, VU) pairs, not their product: a run of an
  // older campaign can match both lists without being one of them
  const pairs = listOf(meta?.profiles).map((profile) => `${profile.cpu}|${profile.vus}`);
  const latest = new Map();

  for (const row of rows) {
    if (row.skipped === true || typeof row.rps !== 'number') {
      continue;
    }
    if (pairs.length > 0 && pairs.includes(`${row.cpu}|${row.vus}`) === false) {
      continue;
    }
    if (vus.length > 0 && vus.includes(Number(row.vus)) === false) {
      continue;
    }
    if (cpus.length > 0 && cpus.includes(Number(row.cpu)) === false) {
      continue;
    }

    const key = [row.vendor || 'Carbone', row.sample, row.template, row.group, row.cpu, row.vus].join('|');
    const previous = latest.get(key);

    if (previous === undefined || String(row.raw?.finishedAt || '') > String(previous.raw?.finishedAt || '')) {
      latest.set(key, row);
    }
  }

  return [...latest.values()];
}

export function toRows (results) {
  return results.map((result) => {
    const name = result.sample || 'unknown';
    const parsed = parseSampleIdentity(name);

    return {
      id        : result.id,
      label     : String(result.label || '').replace(/\(ICE\)/g, '(Carbone ICE)'),
      vendor    : result.vendor || 'Carbone',
      sample    : name,
      family    : result.family || parsed.family,
      pages     : result.pages || parsed.pages,
      template  : (result.templateExt || '').toUpperCase(),
      output    : (result.convertTo || result.templateExt || '').toUpperCase(),
      converter : result.converterName === 'none' ? '—' : (result.converterName === 'ICE' ? 'Carbone ICE' : result.converterName),
      cpu       : result.cpu,
      vus       : result.vus ?? result.metrics?.vus ?? 10,
      profile   : result.profile ?? (Number(result.vus) === 1 ? 'solo' : 'load'),
      group     : result.group,
      skipped   : result.skipped === true,
      error     : result.error ?? null,
      // The median is what a single document is reported with: a run of ten
      // renders has no meaningful average
      med       : result.metrics?.latency?.med ?? null,
      avg       : result.metrics?.latency?.avg ?? null,
      // No document within the render timeout: reported as out of scale rather
      // than with the timeout itself as a duration
      outOfScale : result.outOfScale === true,
      p95       : result.metrics?.latency?.p95 ?? null,
      max       : result.metrics?.latency?.max ?? null,
      rps       : result.metrics?.rps ?? null,
      requests  : result.metrics?.requests?.count ?? null,
      failures  : (result.metrics?.failureRate ?? 0) * 100,
      raw       : result,
    };
  });
}

function pickPreferredCpu (cpus) {
  if (cpus.includes(4) === true) {
    return 4;
  }

  return Math.max(...cpus);
}

function groupBy (rows, keyOf) {
  const groups = new Map();

  for (const row of rows) {
    const key = keyOf(row);

    if (groups.has(key) === false) {
      groups.set(key, []);
    }

    groups.get(key).push(row);
  }

  return [...groups.values()];
}

/**
 * Every measure of one engine — the merge, or one PDF converter — on one
 * dataset: the one-at-a-time run, and the run under load of each factory count.
 */
function buildEngine (key, rows) {
  const load = {};
  let solo = null;

  for (const row of rows) {
    if (row.profile === 'solo') {
      // Two passes can each bring their own: the smallest factory count is the
      // one that timed a document with nothing else running
      if (solo === null || row.cpu < solo.cpu) {
        solo = row;
      }
      continue;
    }

    load[row.cpu] = row;
  }

  return { key: key, engine: engineOf(rows[0]), solo: solo, load: load };
}

const loadOf = (engine, cpu) => engine?.load?.[cpu] ?? null;
const rpsOf = (engine, cpu) => loadOf(engine, cpu)?.rps ?? null;
const soloOf = (engine) => engine?.solo ?? null;

/** Documents per second, whichever run measured this engine. Last if unusable. */
function speedOf (engine, cpu) {
  const loaded = rpsOf(engine, cpu);

  if (Number.isFinite(loaded) === true) {
    return loaded;
  }

  const solo = soloOf(engine);

  return solo === null || solo.outOfScale === true || solo.med > 0 === false ? -1 : 1000 / solo.med;
}

/** All the measures of one template rendered with one dataset (= one page count). */
function buildVariant (rows) {
  const first = rows[0];
  const loaded = rows.filter((row) => row.profile !== 'solo');
  const cpus = [...new Set((loaded.length > 0 ? loaded : rows).map((row) => row.cpu))].sort((a, b) => a - b);
  const chartCpu = pickPreferredCpu(cpus);
  const engines = new Map(groupBy(rows, (row) => row.group).map((group) => [group[0].group, buildEngine(group[0].group, group)]));
  const order = PDF_ORDER[first.template.toLowerCase()] || [...engines.keys()].filter((key) => key !== 'merge');
  // Fastest first, on the throughput under load when there is one — a big
  // document is only ever measured one at a time
  const pdf = order
    .map((key) => engines.get(key))
    .filter((engine) => engine !== undefined)
    .sort((a, b) => speedOf(b, chartCpu) - speedOf(a, chartCpu));

  return {
    pages    : first.pages,
    cpus     : cpus,
    chartCpu : chartCpu,
    merge    : engines.get('merge') ?? null,
    pdf      : pdf,
    winner   : pdf[0] ?? null,
  };
}

/**
 * One card per template file. Its datasets become variants: the smallest
 * document carries the card, the biggest one its pages per second.
 */
function buildCard (rows) {
  const first = rows[0];
  const title = displayName(first.family);
  const variants = groupBy(rows, (row) => row.pages)
    .map(buildVariant)
    .sort((a, b) => a.pages - b.pages);

  return {
    id           : slug(`${title}-${first.template}`),
    family       : first.family,
    title        : title,
    ext          : first.template,
    templateFile : first.raw?.templateFile,
    main         : variants[0],
    big          : variants.length > 1 ? variants[variants.length - 1] : null,
  };
}

export function buildModel (rows, meta) {
  const templates = groupBy(rows, (row) => `${row.vendor}|${row.family}|${row.template}`)
    .map(buildCard)
    .sort((a, b) => {
      if (a.ext !== b.ext) {
        return a.ext.localeCompare(b.ext);
      }

      return a.family.localeCompare(b.family);
    });

  return { meta, templates, measured: rows.length };
}

function formatDate (iso) {
  if (iso === undefined || iso === null) {
    return 'unknown date';
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime()) === true) {
    return String(iso);
  }

  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

export function campaignStamp (meta) {
  const iso = meta?.finishedAt || meta?.startedAt || new Date().toISOString();
  const date = new Date(iso);

  if (Number.isNaN(date.getTime()) === true) {
    return 'unknown';
  }

  return date.toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z');
}

/** Separators of the visitor, not of the author: "9,317" or "9 317". */
const groups = (value, digits) => value.toLocaleString('en-US', {
  minimumFractionDigits : digits,
  maximumFractionDigits : digits,
});

/**
 * A number the page rewrites in the visitor's locale. The value and its
 * precision travel in the markup, so the fallback without JavaScript is the
 * English formatting rather than a raw float.
 */
function numberCell (value, digits = 0) {
  if (Number.isFinite(value) === false) {
    return '–';
  }

  return `<span data-num="${value}" data-digits="${digits}">${groups(value, digits)}</span>`;
}

/**
 * Documents per minute, not per second: a one page invoice is delivered a few
 * hundred times per second while a 200 page report takes seconds, and one unit
 * has to cover both without falling under 1.
 */
function perMinuteOf (rps) {
  const value = rps * 60;

  return { value: value, digits: value >= 100 ? 0 : 1 };
}

function perMinute (rps) {
  if (Number.isFinite(rps) === false) {
    return '–';
  }

  const { value, digits } = perMinuteOf(rps);

  return numberCell(value, digits);
}

/** Same figure for RESULT.md and the README, where markup is out of place. */
function perMinuteText (rps) {
  if (Number.isFinite(rps) === false) {
    return '–';
  }

  const { value, digits } = perMinuteOf(rps);

  return groups(value, digits);
}

/**
 * One duration formatter for a whole block: "710 ms" next to "5.15 s", or
 * "11.00 s" next to "1.5 s", hides exactly what the block is there to compare.
 * The longest duration picks the unit and the precision for all of them.
 */
function timeParts (values) {
  const known = values.filter((value) => Number.isFinite(value) === true);
  const max = known.length > 0 ? Math.max(...known) : 0;
  const asMs = max > 0 && max < 1000;
  const shown = asMs === true ? max : max / 1000;
  // A tenth of a millisecond is noise, a hundredth of a second is not
  const digits = asMs === true
    ? (shown >= 10 ? 0 : 1)
    : (shown >= 100 ? 0 : (shown >= 10 ? 1 : 2));

  return (value) => ({
    value  : asMs === true ? value : value / 1000,
    digits : digits,
    unit   : asMs === true ? 'ms' : 's',
  });
}

function timeFormat (values) {
  const parts = timeParts(values);

  return (value) => {
    if (Number.isFinite(value) === false) {
      return '–';
    }

    const { value: shown, digits, unit } = parts(value);

    return `${numberCell(shown, digits)} ${unit}`;
  };
}

/**
 * Pages per second of one document produced alone. Dividing by the time of a
 * single document rather than by a throughput keeps the figure comparable
 * between a one page invoice and a two hundred page report.
 */
function pagesRate (variant, engine) {
  const solo = soloOf(engine);

  if (variant === null || solo === null || solo.outOfScale === true || solo.med > 0 === false) {
    return null;
  }

  return (variant.pages * 1000) / solo.med;
}

/** No document within the render timeout. */
const OUT_OF_SCALE = '∞';

const isOut = (row) => row !== null && row !== undefined && row.outOfScale === true;

/** One duration on its own, when no column has to be comparable with it. */
const oneTime = (value) => timeFormat([value])(value);

/**
 * The small figure under a throughput is the only latency on the page, and
 * nothing else says what it is now that the report has no introduction. Under
 * load it also carries the wait in the queue, which changes what it means.
 */
function p95Hint (column) {
  const measured = '95% of documents were delivered faster than this.';

  if (column.vus === 1) {
    return `Document latency (p95): ${measured}`;
  }

  const load = column.vus === column.cpu + 1
    ? 'with one more virtual user than the number of CPUs'
    : `with ${column.vus} virtual users on ${column.cpu} CPU`;

  return `Document latency (p95), including queue wait time, ${load}. ${measured}`;
}

/**
 * The bar of one cell, as a tint that fades in from the left and stops on a
 * crisp line at the value. It stays inside its cell, so each column is its own
 * little chart and no edge can be mistaken for a column separator.
 *
 * @param  {String}  color  engine color
 * @param  {Number}  share  0 to 1, of the best value of the column
 * @return {String}  the class and style attributes, or nothing
 */
function fillOf (color, share) {
  if (Number.isFinite(share) === false || share <= 0) {
    return '';
  }

  // The best of a column stops just short of the next one: two full cells side
  // by side would join into a single band across the row again
  return ` class="bar" style="--c:${color}40;--w:${(Math.min(1, share) * 94).toFixed(1)}%"`;
}

/** Full width for the biggest of the column. */
function rateShare (values) {
  const known = values.filter((value) => Number.isFinite(value) === true && value > 0);
  const top = known.length > 0 ? Math.max(...known) : 0;

  return (value) => (top > 0 && Number.isFinite(value) === true ? Math.max(0, value) / top : 0);
}

/**
 * First column. The merge names its own pipeline, since it is alone of its kind;
 * a converter names only its engine, the pipeline they all share being written
 * once above them.
 */
function pipelineCell (ext, engine) {
  if (engine.key !== 'merge') {
    return `<td class="pipe engine"><span class="dot" style="background:${engine.engine.color}"></span>${escape(engine.engine.short)}</td>`;
  }

  // Written like the heading of the converters: both name a pipeline
  return `<td class="pipe group">${escape(sameFormat(ext))}<div class="muted">merge only</div></td>`;
}

/** Fixed first column, so the bars of every row start at the same place. */
const colgroup = (values) => `<colgroup><col class="pipe"/>${'<col/>'.repeat(values)}</colgroup>`;

/** Configuration of the throughput columns, for a header, ex: "4 CPU · 5 VU". */
function loadLabel (model) {
  const card = model.templates[0];
  const cpu = card.main.chartCpu;
  const engines = [card.main.merge, ...card.main.pdf].filter((engine) => engine !== null);
  const vus = engines.map((engine) => loadOf(engine, cpu)?.vus).find((value) => value !== undefined);

  return vus === undefined ? `${cpu} CPU` : `${cpu} CPU · ${vus} VU`;
}

/** Configuration of the one-at-a-time run, ex: "1 CPU · 1 VU". */
function soloLabel (model) {
  const card = model.templates[0];
  const engines = [card.main.merge, ...card.main.pdf].filter((engine) => engine !== null);
  const solo = engines.map(soloOf).find((row) => row !== null && row !== undefined);

  return solo === undefined ? '1 CPU · 1 VU' : `${solo.cpu} CPU · ${solo.vus} VU`;
}

function imageSize (buffer) {
  if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
    return null;
  }

  let offset = 2;

  while (offset < buffer.length - 8) {
    if (buffer[offset] !== 0xFF) {
      offset++;
      continue;
    }

    const marker = buffer[offset + 1];

    if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }

    if (marker === 0xD8 || marker === 0x01) {
      offset += 2;
      continue;
    }

    if (marker === 0xD9 || marker === 0xDA) {
      break;
    }

    offset += 2 + buffer.readUInt16BE(offset + 2);
  }

  return null;
}

function previewSrc (templateFile) {
  if (templateFile === undefined || templateFile === null || templateFile === '') {
    return null;
  }

  const base = path.basename(templateFile);

  for (const name of [`${base}.jpg`, `${base}.jpeg`, `${base}.png`]) {
    const abs = path.join(DOCS_DIR, 'previews', name);

    if (fs.existsSync(abs) === true) {
      return { href: `previews/${name}`, abs };
    }
  }

  return null;
}

function previewFigure (card) {
  const src = previewSrc(card.templateFile);

  if (src === null) {
    return '';
  }

  // Intrinsic size, only to reserve the room before the image arrives: the
  // column is the same width for a portrait and for a landscape
  const size = imageSize(fs.readFileSync(src.abs));
  const box = size === null ? '' : ` width="${size.width}" height="${size.height}"`;

  return `<figure class="preview">
    <img src="${escape(src.href)}" alt="${escape(card.title)} template preview"${box}/>
  </figure>`;
}

/**
 * One column per measured configuration: the factory count and the number of
 * parallel requests it was measured with, since both change the answer.
 */
function throughputColumns (variant) {
  const engines = [variant.merge, ...variant.pdf].filter((engine) => engine !== null);
  const columns = [];
  const solo = engines.map(soloOf).find((row) => row !== null && row !== undefined);

  if (solo !== undefined) {
    columns.push({ cpu: solo.cpu, vus: solo.vus, pick: soloOf });
  }

  for (const cpu of variant.cpus) {
    const row = engines.map((engine) => loadOf(engine, cpu)).find((value) => value !== null);

    if (row !== undefined) {
      columns.push({ cpu: cpu, vus: row.vus, pick: (engine) => loadOf(engine, cpu) });
    }
  }

  return columns;
}

/**
 * Header of a column: the unit first, since that is what the figures are read
 * with, and the configuration it was measured with just below.
 */
function unitHead (unit, detail, hint) {
  return `<th><span class="unit">${unit}</span>
        <div class="muted hint" data-hint="${escape(hint)}">${escape(detail)}</div></th>`;
}

/** What a VU is, and what this many of them does to the figures of the column. */
function vuHint (column) {
  const what = 'A VU is a virtual user, sending one request after the other. ';

  if (column.vus === 1) {
    return `${what}One request in flight on ${column.cpu} CPU: one document at a time, nothing waiting in a queue.`;
  }

  return `${what}${column.vus} requests in flight on ${column.cpu} CPU: the figures include the wait in the queue.`;
}

/** Where the pages per second comes from, since the column only shows a rate. */
function pagesHint (big) {
  return `Page generation speed for one ${big === true ? 'large ' : ''}document, `
    + 'processed alone on a single CPU.';
}

function rateCell (column, engine, share) {
  const row = column.pick(engine);

  if (row === null || row === undefined) {
    return '<td>–</td>';
  }
  if (isOut(row) === true) {
    return `<td>${OUT_OF_SCALE}</td>`;
  }

  // No "p95" written on every line: the hover says it, once discovered
  const p95 = Number.isFinite(row.p95) === true
    ? `<div class="muted hint" data-hint="${escape(p95Hint(column))}">${oneTime(row.p95)}</div>`
    : '';

  return `<td${fillOf(engine.engine.color, share)}><strong>${perMinute(row.rps)}</strong>${p95}</td>`;
}

/**
 * Everything measured on one template, in one table: what the server delivers
 * on one factory and on four, then the pages per second that puts a one page
 * invoice and a several hundred page report on the same scale.
 *
 * The merge sits on its own body, apart and without a bar: it does not go
 * through the conversion factories, so it is not on their scale. The converters
 * share one heading, so three rows read as one theme instead of three pipelines.
 */
function resultsTable (card) {
  const { main, big } = card;
  const columns = throughputColumns(main);
  const engines = [main.merge, ...main.pdf].filter((engine) => engine !== null);

  if (columns.length === 0 || engines.length === 0) {
    return '<p class="muted">Nothing measured for this template in the latest campaign.</p>';
  }

  // Pages per second comes from the biggest dataset available: it is there to
  // make sizes comparable, so it answers on the size that stresses the pipeline
  const source = big ?? main;
  const bigOf = big === null
    ? (engine) => engine
    : (engine) => [big.merge, ...big.pdf].find((other) => other !== null && other.key === engine.key) ?? null;
  const rateRow = (engine) => soloOf(bigOf(engine));
  const rateOf = (engine) => (bigOf(engine) === null ? null : pagesRate(source, bigOf(engine)));
  // One scale per column, and only the converters set it
  const shares = columns.map((column) => rateShare(main.pdf.map((engine) => column.pick(engine)?.rps)));
  const pagesShare = rateShare(main.pdf.map(rateOf));
  const head = columns
    .map((column) => unitHead('Doc/min', `${column.cpu} CPU · ${column.vus} VU`, vuHint(column)))
    .join('');
  // Only the big dataset deserves the "big documents" wording
  const pagesDetail = big === null ? `on ${pagesLabel(main.pages)}` : 'on large documents';
  const cells = (engine, tinted) => {
    const rate = rateOf(engine);
    const pages = isOut(rateRow(engine)) === true
      ? OUT_OF_SCALE
      : (rate === null ? '–' : `<strong>${numberCell(Math.round(rate))}</strong>`);
    const throughput = columns
      .map((column, index) => rateCell(column, engine, tinted === true ? shares[index](column.pick(engine)?.rps) : 0))
      .join('');

    return `${throughput}<td${tinted === true ? fillOf(engine.engine.color, pagesShare(rate)) : ''}>${pages}</td>`;
  };
  // A bar chart of a single converter compares nothing: HTML only has Chromium
  const tinted = main.pdf.length > 1;
  const merge = main.merge === null
    ? ''
    : `<tbody><tr class="apart">${pipelineCell(card.ext, main.merge)}${cells(main.merge, false)}</tr></tbody>`;
  const converters = main.pdf.length === 0
    ? ''
    : `<tbody>
        <tr class="group-head"><th colspan="${columns.length + 2}">${escape(toPdf(card.ext))}</th></tr>
        ${main.pdf.map((engine) => `<tr>${pipelineCell(card.ext, engine)}${cells(engine, tinted)}</tr>`).join('')}
      </tbody>`;
  const timedOut = engines.some((engine) => isOut(rateRow(engine)) === true
    || columns.some((column) => isOut(column.pick(engine)) === true));
  const timeout = engines.map((engine) => rateRow(engine)?.raw?.timeout).find((value) => value !== undefined) ?? '120s';

  return `<table class="grid">
      ${colgroup(columns.length + 1)}
      <thead><tr>
        <th></th>
        ${head}
        ${unitHead('Pages/s', pagesDetail, pagesHint(big !== null))}
      </tr></thead>
      ${merge}${converters}
    </table>
    ${timedOut === true ? `<p class="muted small">${OUT_OF_SCALE} = no document produced within ${escape(timeout)}.</p>` : ''}`;
}

function templateSection (card) {
  const preview = previewFigure(card);

  return `<section class="card" id="${card.id}">
    <header class="card-head">
      <h2 class="template-name">${escape(card.title)}</h2>
      <p class="template-meta"><span class="badge">${escape(formatLabel(card.ext))}</span></p>
    </header>
    <div class="card-body${preview === '' ? ' card-body-wide' : ''}">
      ${preview}
      <div class="card-data">${resultsTable(card)}</div>
    </div>
  </section>`;
}

function historyNav (archive, currentId) {
  if (archive.length === 0) {
    return '';
  }

  const items = archive.map((entry) => {
    const current = entry.id === currentId;
    const label = formatDate(entry.date);

    return current
      ? `<li><strong>${escape(label)}</strong> — this report</li>`
      : `<li><a href="${escape(entry.file)}">${escape(label)}</a> · ${entry.measured} runs</li>`;
  }).join('');

  return `<section class="card" id="history">
    <h2>Previous benchmarks</h2>
    <p class="muted">Each campaign writes a dated page. Latest is also <a href="index.html">index.html</a>.</p>
    <ul class="history">${items}</ul>
  </section>`;
}

const CSS = `
:root {
  --bg: #f6f3f8;
  --card: #ffffff;
  --ink: #1c1224;
  --muted: #6d6278;
  --line: #e6ddee;
  --accent: #A644C5;
  --max: 1080px;
  /* Same width for a portrait and for a landscape preview */
  --thumb: 190px;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font: 15px/1.5 "Avenir Next", "Segoe UI", sans-serif;
  color: var(--ink);
  background: var(--bg);
}
a { color: var(--accent); }
header.top {
  background: #1c1224;
  color: #fff;
  padding: 28px 0 24px;
}
header.top a { color: #f3c9ff; }
.wrap { max-width: var(--max); margin: 0 auto; padding: 0 20px; }
header.top h1 { margin: 6px 0 8px; font-size: 28px; }
.meta { color: #d8cbe2; font-size: 13px; }
.ctas {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}
.cta-group { display: flex; flex-wrap: wrap; gap: 8px; }
.cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--accent);
  color: #fff;
  text-decoration: none;
  padding: 9px 14px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  border: 1px solid transparent;
}
.cta svg { width: 16px; height: 16px; fill: currentColor; }
.cta:hover { color: #fff; filter: brightness(1.08); }
.cta-ghost {
  background: transparent;
  border-color: #5a4568;
  color: #fff;
  font-weight: 600;
}
.cta-ghost:hover { background: #2b1b38; filter: none; }
header.top .cta-site {
  margin-left: auto;
  color: #c9b4d6;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  letter-spacing: 0.01em;
}
header.top .cta-site:hover { color: #fff; }
/* Beats the horizontal padding of .wrap, which has the stronger selector */
main.wrap { padding-top: 40px; padding-bottom: 80px; }
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 44px 44px 38px;
  margin: 0 0 22px;
}
/* Preview on the left, table on the right: one glance takes both */
.card-body {
  display: grid;
  grid-template-columns: var(--thumb) 1fr;
  gap: 24px;
  align-items: start;
}
.card-body-wide { grid-template-columns: 1fr; }
.card-data { min-width: 0; }
.card-head { margin-bottom: 14px; }
.card h2 { margin: 0 0 8px; }
.template-name {
  margin: 0 0 6px;
  font-size: 24px;
  line-height: 1.2;
  letter-spacing: -0.02em;
}
.template-meta {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
}
.badge {
  display: inline-block;
  background: #f0eaf4;
  color: var(--ink);
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
}
.eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: 11px; color: var(--muted); margin: 0 0 4px; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 10px 8px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; color: var(--muted); font-weight: 600; }
/* The unit leads the column, the configuration it was measured with follows */
.unit { font-size: 14px; color: var(--ink); }
/* Fixed columns, so a bar means the same width from one row to the next */
.grid { --pipe: 150px; table-layout: fixed; }
.grid col.pipe { width: var(--pipe); }
.grid tbody td { padding-top: 10px; padding-bottom: 12px; }
.grid td.pipe .muted { font-size: 12px; }
/* "227 ms" never splits from its unit, even in a narrow column */
.grid td .muted { white-space: nowrap; }
/*
 * The bubble of the latency. A native title never shows up as a bubble in every
 * browser, and the dotted rule is what makes the hover findable at all.
 */
.hint {
  position: relative;
  width: fit-content;
  cursor: help;
  text-decoration: underline dotted #cdc2d6;
  text-underline-offset: 3px;
}
.hint::after {
  content: attr(data-hint);
  position: absolute;
  left: 0;
  bottom: 100%;
  z-index: 5;
  width: 250px;
  margin-bottom: 8px;
  padding: 9px 11px;
  border-radius: 8px;
  background: #1c1224;
  color: #fff;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.45;
  white-space: normal;
  text-decoration: none;
  box-shadow: 0 8px 20px rgba(28, 18, 36, .28);
  opacity: 0;
  visibility: hidden;
  transition: opacity .12s ease;
}
.hint:hover::after { opacity: 1; visibility: visible; }
/* A pipeline name: on its own row for the converters, in the cell for the merge */
.grid .group-head th, .grid td.group {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.grid .group-head th { padding: 18px 0 4px; border-bottom: 0; }
.grid td.group .muted { font-weight: 400; }
.grid td.engine { padding-left: 16px; }
/*
 * The bar of one cell: it fades in from the left and ends on a crisp line at
 * the value, so the eye follows the edges without reading them as a grid.
 */
.grid td.bar {
  background-image: linear-gradient(90deg, transparent 0, var(--c) var(--w), transparent var(--w));
}
/* Air on the left of every value, tinted or not, so the columns stay aligned */
.grid th + th, .grid td + td { padding-left: 8px; }
/* Merge only: same table, but nothing to compare with the converters below */
.grid tr.apart td { border-bottom: 2px solid #cfc2dc; padding-bottom: 14px; }
.preview { margin: 0; }
.preview img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 300px;
  object-fit: contain;
  object-position: top;
  border-radius: 8px;
  border: 1px solid var(--line);
  box-shadow: 0 10px 24px rgba(28, 18, 36, .12);
  background: #fff;
}
.history { padding-left: 18px; }
footer { color: var(--muted); font-size: 12px; padding: 0 0 40px; }
@media (max-width: 780px) {
  /* The luxury of a wide margin does not fit on a phone */
  .card { padding: 24px 20px 20px; }
  /* Preview first, then the table, as it comes in the markup */
  .card-body { grid-template-columns: 1fr; gap: 16px; }
  .preview img { max-width: var(--thumb); }
  table { font-size: 13px; }
  /* Enough for "DOCX → DOCX" to stay on one line */
  .grid { --pipe: 122px; }
  .grid th { font-size: 11px; }
  .grid .group-head th, .grid td.group { font-size: 13px; }
  /* Anchored on its right, the bubble cannot run past a narrow screen */
  .hint::after { width: 210px; left: auto; right: 0; }
}
`;

/**
 * Numbers are written with English separators, then rewritten in the visitor's
 * locale: "9,317" reads "9 317" for a French browser. The whole page is static,
 * so this is the only script it carries.
 */
const LOCALE_SCRIPT = `
(function () {
  if (window.Intl === undefined) { return; }

  var format = function (digits) {
    try {
      return new Intl.NumberFormat(navigator.language || undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      });
    } catch (error) {
      return null;
    }
  };
  var cells = document.querySelectorAll('[data-num]');
  var formatters = {};

  for (var i = 0; i < cells.length; i++) {
    var value = Number(cells[i].getAttribute('data-num'));
    var digits = Number(cells[i].getAttribute('data-digits')) || 0;

    if (isFinite(value) === false) { continue; }
    if (formatters[digits] === undefined) { formatters[digits] = format(digits); }
    if (formatters[digits] === null) { return; }

    cells[i].textContent = formatters[digits].format(value);
  }
})();
`;

export function renderHtml ({ model, archive, currentId }) {
  const meta = model.meta || {};
  const date = formatDate(meta.finishedAt || meta.startedAt);
  const vus = listOf(meta.vus).join(' and ') || '1 and 10';
  const cpus = listOf(meta.cpus).join(', ') || '?';
  const host = meta.host?.cpu ? `${meta.host.cpu} · ${meta.host.cores} cores` : 'unknown host';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Carbone benchmark — ${escape(date)}</title>
  <style>${CSS}</style>
</head>
<body>
  <header class="top">
    <div class="wrap">
      <p class="eyebrow">Public benchmark</p>
      <h1>How fast is Carbone?</h1>
      <p class="meta">
        ${escape(date)}
        · ${escape(meta.image || 'carbone-ee')}
        · ${escape(vus)} VU
        · ${escape(cpus)} CPU
        · ${escape(host)}
      </p>
      <div class="ctas">
        <div class="cta-group">
          <a class="cta" href="https://github.com/carboneio/document-generator-benchmark" target="_blank" rel="noopener">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"/></svg>
            Run it on your machine
          </a>
          <a class="cta cta-ghost" href="#history">Previous benchmark</a>
        </div>
        <a class="cta-site" href="https://carbone.io" target="_blank" rel="noopener">Generate documents with Carbone →</a>
      </div>
    </div>
  </header>
  <main class="wrap">
    ${model.templates.length
      ? model.templates.map(templateSection).join('\n')
      : '<section class="card"><p class="muted">No measured run in the latest campaign. Execute <code>npm run bench</code>.</p></section>'}
    ${historyNav(archive, currentId)}
  </main>
  <footer class="wrap">Generated by <code>npm run bench</code> / <code>npm run report</code>. Raw metrics: RESULT.md.</footer>
  <script>${LOCALE_SCRIPT}</script>
</body>
</html>
`;
}

export function summaryMarkdown (model, { pageHref = 'docs/index.html', archiveHref = 'docs/index.html#history' } = {}) {
  if (model.templates.length === 0) {
    return `_No measured run in the latest campaign — execute \`npm run bench\`._`;
  }

  const date = formatDate(model.meta?.finishedAt || model.meta?.startedAt);
  const load = loadLabel(model);
  const solo = soloLabel(model);
  const lines = [
    `Latest report: **[${date}](${pageHref})** · [previous benchmarks](${archiveHref})`,
    '',
    '| Template sample | Merge only (Doc/min) | Convert to PDF (Doc/min) | Pages/s |',
    '| --- | --- | --- | --- |',
  ];

  for (const card of model.templates) {
    const { main, big } = card;
    const merge = rpsOf(main.merge, main.chartCpu);
    const winner = main.winner;
    const source = big ?? main;
    const rate = pagesRate(source, source.winner);
    const pdf = winner === null
      ? '–'
      : `**${perMinuteText(rpsOf(winner, main.chartCpu))}** · ${toPdf(card.ext)} (fastest: ${winner.engine.short})`;
    const pages = rate === null
      ? '–'
      : `**${groups(Math.round(rate), 0)}** on ${pagesLabel(source.pages)} (${source.winner.engine.short})`;

    lines.push(`| [\`${card.title}\`](${pageHref}#${card.id}) | ${merge === null ? '–' : `${sameFormat(card.ext)} **${perMinuteText(merge)}**`} | ${pdf} | ${pages} |`);
  }

  lines.push('', `Both throughputs at **${load}**, pages per second on one document alone at **${solo}**.`
    + ` The [report page](${pageHref}) adds the ${solo} throughput, the p95 latency of every column`
    + ' and a preview of each document.');

  return lines.join('\n');
}
