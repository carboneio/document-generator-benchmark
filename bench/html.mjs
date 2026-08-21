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

const GITHUB_SAMPLES = 'https://github.com/carboneio/document-generator-benchmark/blob/master/samples';

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
  chart           : 'financial_chart',
  incoice_simple  : 'invoice_simple',
  qrcode          : 'ticket_qrcode',
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

const num = (value, digits = 2) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '–');

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

/** Keep only successful runs that belong to the latest campaign (VU / CPU). */
export function filterCampaign (rows, meta) {
  const vus = listOf(meta?.vus).map(Number).filter(Boolean);
  const cpus = listOf(meta?.cpus).map(Number).filter(Boolean);
  const latest = new Map();

  for (const row of rows) {
    if (row.skipped === true || typeof row.rps !== 'number') {
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
      group     : result.group,
      skipped   : result.skipped === true,
      error     : result.error ?? null,
      avg       : result.metrics?.latency?.avg ?? null,
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

function buildTemplate (rows) {
  const first = rows[0];
  const cpus = [...new Set(rows.map((row) => row.cpu))].sort((a, b) => a - b);
  const chartCpu = pickPreferredCpu(cpus);
  const pdfKeys = PDF_ORDER[first.template.toLowerCase()] || [...new Set(rows.filter((row) => row.group !== 'merge').map((row) => row.group))];
  const merge = {};
  const pdf = {};

  for (const row of rows) {
    if (row.group === 'merge') {
      merge[row.cpu] = row;
      continue;
    }

    pdf[row.group] = pdf[row.group] || {};
    pdf[row.group][row.cpu] = row;
  }

  const chartRows = pdfKeys
    .map((key) => pdf[key]?.[chartCpu])
    .filter(Boolean)
    .sort((a, b) => (b.rps ?? 0) - (a.rps ?? 0));

  const winner = chartRows[0] || null;
  const title = displayName(first.family);

  return {
    id           : slug(`${title}-${first.template}-${first.pages}`),
    family       : first.family,
    title        : title,
    ext          : first.template,
    pages        : first.pages,
    templateFile : first.raw?.templateFile,
    dataFile     : first.raw?.dataFile,
    cpus         : cpus,
    chartCpu     : chartCpu,
    merge        : merge,
    pdf          : pdf,
    pdfKeys      : pdfKeys.filter((key) => pdf[key] !== undefined),
    chartRows    : chartRows,
    winner       : winner,
  };
}

export function buildModel (rows, meta) {
  const groups = new Map();

  for (const row of rows) {
    const key = `${row.vendor}|${row.family}|${row.template}|${row.pages}`;

    if (groups.has(key) === false) {
      groups.set(key, []);
    }

    groups.get(key).push(row);
  }

  const templates = [...groups.values()]
    .map(buildTemplate)
    .sort((a, b) => {
      if (a.ext !== b.ext) {
        return a.ext.localeCompare(b.ext);
      }
      if (a.family !== b.family) {
        return a.family.localeCompare(b.family);
      }

      return a.pages - b.pages;
    });

  return { meta, templates };
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

function barChart (rows) {
  if (rows.length === 0) {
    return '<p class="muted">No PDF conversion measured for this template in the latest campaign.</p>';
  }

  const max = Math.max(...rows.map((row) => row.rps || 0), 1);

  return `<div class="bars">${rows.map((row) => {
    const engine = engineOf(row);
    const width = Math.max(4, (row.rps / max) * 100);

    return `<div class="bar-row">
      <div class="bar-name">${escape(engine.short)}</div>
      <div class="bar-track"><div class="bar" style="width:${width.toFixed(1)}%;background:${engine.color}"></div></div>
      <div class="bar-value"><strong>${num(row.rps, 1)}</strong> RPS<span class="muted"> · ${num(row.avg, 1)} ms</span></div>
    </div>`;
  }).join('')}</div>`;
}

function cpuTable (template) {
  if (template.pdfKeys.length === 0) {
    return '';
  }

  const head = template.cpus.map((cpu) => `<th>${cpu} CPU (RPS)</th>`).join('');
  const rows = template.pdfKeys.map((key) => {
    const engine = ENGINE[key] || { short: key, color: '#888' };
    const cells = template.cpus.map((cpu) => {
      const row = template.pdf[key]?.[cpu];

      return `<td>${row ? `<strong>${num(row.rps, 1)}</strong><div class="muted">${num(row.avg, 1)} ms</div>` : '–'}</td>`;
    }).join('');

    const first = template.pdf[key]?.[template.cpus[0]];
    const last = template.pdf[key]?.[template.cpus[template.cpus.length - 1]];
    const gain = first && last && first.rps > 0 && template.cpus.length > 1
      ? `×${num(last.rps / first.rps, 1)}`
      : '–';

    return `<tr>
      <td><span class="dot" style="background:${engine.color}"></span>${escape(engine.short)}</td>
      ${cells}
      <td>${gain}</td>
    </tr>`;
  }).join('');

  return `<table>
    <thead><tr><th>Converter</th>${head}<th>Scaling</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function pdfCell (item) {
  const winner = item.winner;

  if (winner === undefined || winner === null) {
    return '–';
  }

  return `<strong>${num(winner.rps, 1)}</strong><div class="muted">${escape(toPdf(item.ext))} (fastest: ${escape(engineOf(winner).short)})</div>`;
}

function summaryTable (templates) {
  const cpu = templates[0] ? templates[0].chartCpu : 4;
  const body = templates.map((item) => {
    const fill = item.merge[item.chartCpu] || item.merge[item.cpus[item.cpus.length - 1]];

    return `<tr>
      <td><a href="#${item.id}">${escape(item.title)}</a><div class="muted">${escape(pagesLabel(item.pages))}</div></td>
      <td>${fill ? `<strong>${num(fill.rps, 1)}</strong><div class="muted">${escape(sameFormat(item.ext))}</div>` : '–'}</td>
      <td>${pdfCell(item)}</td>
    </tr>`;
  }).join('');

  return `<table>
    <thead><tr>
      <th>Template sample</th>
      <th>Merge only @ ${cpu} CPU (RPS)</th>
      <th>Convert to PDF @ ${cpu} CPU (RPS)</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
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

function previewFigure (item) {
  const src = previewSrc(item.templateFile);

  if (src === null) {
    return '';
  }

  const size = imageSize(fs.readFileSync(src.abs));
  const landscape = size !== null && size.width > size.height;
  const width = landscape === true ? 280 : 148;

  return `<figure class="preview${landscape === true ? ' preview-landscape' : ''}">
    <img src="${escape(src.href)}" alt="${escape(item.title)} template preview" width="${width}"/>
  </figure>`;
}

function sampleLink (filename) {
  if (filename === undefined || filename === null || filename === '') {
    return '';
  }

  const href = `${GITHUB_SAMPLES}/${encodeURIComponent(filename)}`;

  return `<a href="${escape(href)}" target="_blank" rel="noopener">${escape(filename)}</a>`;
}

function sampleFiles (item) {
  const template = sampleLink(item.templateFile);
  const data = sampleLink(item.dataFile);

  if (template === '') {
    return '';
  }

  return `<p class="muted file">${template}${data ? ` + ${data}` : ''}</p>`;
}

function templateSection (item) {
  const fill = item.merge[item.chartCpu];
  const winner = item.winner;

  return `<section class="card" id="${item.id}">
    <div class="card-top">
      <div class="card-intro">
        <header>
          <h2 class="template-name">${escape(item.title)}</h2>
          <p class="template-meta">
            <span class="badge">${escape(formatLabel(item.ext))}</span>
            <span class="badge badge-pages">${escape(pagesLabel(item.pages))}</span>
          </p>
          ${sampleFiles(item)}
        </header>
        <article class="mode">
          <p class="eyebrow">Merge only</p>
          <h3>${escape(sameFormat(item.ext))}</h3>
          <p class="stat">${fill ? `${num(fill.rps, 1)} <small>RPS @ ${item.chartCpu} CPU</small>` : '–'}</p>
        </article>
      </div>
      ${previewFigure(item)}
    </div>
    <article class="mode">
      <p class="eyebrow">Convert to PDF</p>
      <h3>${escape(toPdf(item.ext))}</h3>
      ${barChart(item.chartRows)}
      ${winner ? `<p class="muted">Fastest here: <strong>${escape(engineOf(winner).short)}</strong></p>` : ''}
      ${cpuTable(item)}
    </article>
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
main { padding: 40px 0 80px; }
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 22px 22px 18px;
  margin: 0 0 22px;
}
.card-top {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 20px;
  align-items: stretch;
  margin-bottom: 12px;
}
.card-intro {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.card-intro .mode { flex: 1; }
.card h2 { margin: 0 0 8px; }
.template-name {
  margin: 0 0 6px;
  font-size: 24px;
  line-height: 1.2;
  letter-spacing: -0.02em;
}
.template-meta {
  margin: 0 0 4px;
  font-size: 13px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 8px;
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
.badge-pages {
  background: #fff;
  border: 1px solid var(--line);
  color: var(--muted);
  font-weight: 600;
}
h3 { margin: 18px 0 6px; font-size: 15px; }
.eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: 11px; color: var(--muted); margin: 0 0 4px; }
.muted { color: var(--muted); }
.file { font-size: 12px; }
.file a { color: var(--accent); }
.stat { font-size: 28px; font-weight: 700; margin: 4px 0; }
.stat small { font-size: 14px; font-weight: 600; color: var(--muted); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 10px 8px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; color: var(--muted); font-weight: 600; }
.bars { display: grid; gap: 10px; margin: 12px 0 8px; }
.bar-row { display: grid; grid-template-columns: 128px 1fr 170px; gap: 10px; align-items: center; }
.bar-name { font-weight: 600; }
.bar-track { background: #f0eaf4; border-radius: 999px; height: 14px; overflow: hidden; }
.bar { height: 100%; border-radius: 999px; }
.bar-value { font-size: 13px; }
#summary { margin-top: 16px; margin-bottom: 36px; }
#details { margin-bottom: 22px; }
.section-title { margin: 0 0 12px; font-size: 22px; }
.preview { margin: 0; }
.preview img {
  display: block;
  width: 148px;
  height: auto;
  border-radius: 8px;
  border: 1px solid var(--line);
  box-shadow: 0 10px 24px rgba(28, 18, 36, .12);
  background: #fff;
}
.preview-landscape img { width: 280px; }
.mode {
  background: #faf7fc;
  border-radius: 12px;
  padding: 14px 16px 12px;
  border-left: 3px solid var(--accent);
}
.mode h3 { margin: 0 0 8px; font-size: 16px; }
.mode .eyebrow { color: var(--accent); }
.mode table { margin-top: 8px; }
.history { padding-left: 18px; }
footer { color: var(--muted); font-size: 12px; padding: 0 0 40px; }
@media (max-width: 720px) {
  .bar-row, .card-top { display: block; }
  .bar-track { margin: 4px 0; }
  .preview { margin-top: 12px; }
}
`;

export function renderHtml ({ model, archive, currentId }) {
  const meta = model.meta || {};
  const date = formatDate(meta.finishedAt || meta.startedAt);
  const vus = listOf(meta.vus).join(', ') || '10';
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
        · ${escape(vus)} VU · ${escape(meta.duration || '?')}
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
    <section id="summary">
      <h2 class="section-title">Summary — best results</h2>
      ${model.templates.length ? summaryTable(model.templates) : '<p class="muted">No measured run in the latest campaign. Execute <code>npm run bench</code>.</p>'}
    </section>
    <section id="details">
      <h2 class="section-title">Results by template</h2>
      ${model.templates.map(templateSection).join('\n')}
    </section>
    ${historyNav(archive, currentId)}
  </main>
  <footer class="wrap">Generated by <code>npm run bench</code> / <code>npm run report</code>. Raw metrics: RESULT.md.</footer>
</body>
</html>
`;
}

export function summaryMarkdown (model, { pageHref = 'docs/index.html', archiveHref = 'docs/index.html#history' } = {}) {
  if (model.templates.length === 0) {
    return `_No measured run in the latest campaign — execute \`npm run bench\`._`;
  }

  const date = formatDate(model.meta?.finishedAt || model.meta?.startedAt);
  const cpu = model.templates[0]?.chartCpu || 4;
  const lines = [
    `Latest report: **[${date}](${pageHref})** · [previous benchmarks](${archiveHref})`,
    '',
    `| Template sample | Merge only @ ${cpu} CPU (RPS) | Convert to PDF @ ${cpu} CPU (RPS) |`,
    '| --------------- | --------------------------- | ------------------------------- |',
  ];

  for (const item of model.templates) {
    const fill = item.merge[item.chartCpu];
    const winner = item.winner;
    const pdf = winner
      ? `**${num(winner.rps, 1)}** · ${toPdf(item.ext)} (fastest: ${engineOf(winner).short})`
      : '–';

    lines.push(`| [\`${item.title}\`](${pageHref}#${item.id}) | ${fill ? `${sameFormat(item.ext)} **${num(fill.rps, 1)}**` : '–'} | ${pdf} |`);
  }

  return lines.join('\n');
}
