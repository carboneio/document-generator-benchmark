#!/usr/bin/env node
/**
 * Turns the JSON results written by `bench/run.mjs` into:
 *   - result.svg              horizontal bar chart, sorted by throughput
 *   - RESULT.md              full table + raw metrics of every run
 *   - results/results.csv    same data, machine readable
 *   - README.md             the summary table, between the BENCHMARK markers
 *
 *   node bench/report.mjs [resultsDir]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR } from './matrix.mjs';

const GROUP_COLORS = {
  merge : '#A644C5',
  L     : '#ff7f0e',
  O     : '#2ca02c',
  C     : '#358BBA',
};

const GROUP_ORDER = ['merge', 'L', 'O', 'C'];
const GROUP_LABELS = {
  merge : 'Merge only (no conversion)',
  L     : 'PDF via LibreOffice',
  O     : 'PDF via OnlyOffice',
  C     : 'PDF via Chromium',
};

const SKIPPED_COLOR = '#d9d9d9';
const MARKER_START = '<!-- BENCHMARK:TABLE:START -->';
const MARKER_END = '<!-- BENCHMARK:TABLE:END -->';

/* ------------------------------------------------------------------- utils */

const num = (value, digits = 2) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'n/a');

function escapeXml (text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function niceStep (maxValue, targetTicks = 10) {
  if (maxValue <= 0) {
    return 1;
  }

  const raw = maxValue / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));

  for (const factor of [1, 2, 2.5, 5, 10]) {
    if (factor * magnitude >= raw) {
      return factor * magnitude;
    }
  }

  return 10 * magnitude;
}

function readResults (resultsDir) {
  if (fs.existsSync(resultsDir) === false) {
    return { meta: null, results: [] };
  }

  const indexPath = path.join(resultsDir, 'index.json');

  if (fs.existsSync(indexPath) === true) {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

    return { meta: index.meta ?? null, results: index.results ?? [] };
  }

  const results = fs.readdirSync(resultsDir)
    .filter((file) => file.endsWith('.json') === true && file !== 'index.json')
    .map((file) => JSON.parse(fs.readFileSync(path.join(resultsDir, file), 'utf8')));

  return { meta: null, results };
}

/** Flat rows ready to be displayed, fastest first. */
function toRows (results) {
  return results
    .map((result) => ({
      id        : result.id,
      label     : result.label,
      sample    : result.sample,
      template  : (result.templateExt || '').toUpperCase(),
      output    : (result.convertTo || result.templateExt || '').toUpperCase(),
      converter : result.converterName === 'none' ? '—' : result.converterName,
      cpu       : result.cpu,
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
    }))
    .sort((a, b) => {
      if (a.skipped !== b.skipped) {
        return a.skipped === true ? 1 : -1;
      }
      return (b.rps ?? 0) - (a.rps ?? 0);
    });
}

/* --------------------------------------------------------------------- svg */

function placeholderSvg (message) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="160">
  <rect width="820" height="160" x="0" y="0" fill="#FFFFFF" id="background"/>
  <text x="410" y="70" text-anchor="middle" style="font-family: Arial, sans-serif; font-size: 18px; font-weight: bold; fill: #A644C5;">Carbone benchmark</text>
  <text x="410" y="100" text-anchor="middle" style="font-family: Arial, sans-serif; font-size: 13px; fill: #444;">${escapeXml(message)}</text>
</svg>
`;
}

function buildSvg (rows) {
  if (rows.length === 0) {
    return placeholderSvg('No result yet — run `npm run bench` to generate the chart.');
  }

  const fontSize = 12;
  const barHeight = 26;
  const gap = 10;
  const marginTop = 20;
  const marginBottom = 44;
  const plotWidth = 620;
  const legendWidth = 220;
  const rowHeight = barHeight + gap;

  const longest = Math.max(...rows.map((row) => row.label.length));
  const marginLeft = Math.min(430, Math.max(220, Math.round(longest * 6.3) + 20));

  const plotHeight = rows.length * rowHeight;
  const width = marginLeft + plotWidth + legendWidth;
  const height = marginTop + plotHeight + marginBottom;

  const maxRps = Math.max(1, ...rows.map((row) => row.rps ?? 0));
  const step = niceStep(maxRps);
  const axisMax = Math.ceil(maxRps / step) * step;
  const scale = (value) => (value / axisMax) * plotWidth;

  const bars = [];
  const yTicks = [];

  rows.forEach((row, index) => {
    const y = index * rowHeight + gap / 2;
    const barWidth = row.skipped === true ? 0 : scale(row.rps ?? 0);
    const color = row.skipped === true ? SKIPPED_COLOR : (GROUP_COLORS[row.group] || '#888888');

    bars.push(`          <rect id="bar - ${escapeXml(row.label)}" x="0" y="${y}" height="${barHeight}" width="${Math.max(barWidth, row.skipped === true ? 2 : 1)}" fill="${color}"/>`);

    const value = row.skipped === true
      ? 'unavailable'
      : `${num(row.rps, 1)} RPS · ${num(row.avg, 1)} ms`;
    const valueWidth = value.length * 6.3 + 12;
    const inside = barWidth > valueWidth + 20;
    const textX = inside === true ? barWidth - 8 : barWidth + 8;
    const anchor = inside === true ? 'end' : 'start';
    const fill = inside === true ? '#FFFFFF' : '#333333';

    bars.push(`          <text x="${textX.toFixed(1)}" y="${(y + barHeight / 2).toFixed(1)}" dy="0.32em" text-anchor="${anchor}" style="font-family: Arial, sans-serif; font-size: 11px; fill: ${fill};">${escapeXml(value)}</text>`);

    yTicks.push(`          <g class="tick" opacity="1" transform="translate(0,${(y + barHeight / 2).toFixed(1)})">
            <line stroke="currentColor" x2="-6"/>
            <text fill="currentColor" x="-9" dy="0.32em" style="font-family: Arial, sans-serif; font-size: ${fontSize}px;">${escapeXml(row.label)}</text>
          </g>`);
  });

  const xTicks = [];

  for (let value = 0; value <= axisMax + 1e-9; value += step) {
    xTicks.push(`          <g class="tick" opacity="1" transform="translate(${scale(value).toFixed(2)},0)">
            <line stroke="currentColor" y2="6"/>
            <text fill="currentColor" y="9" dy="0.71em">${Number(value.toFixed(4))}</text>
          </g>`);
  }

  const usedGroups = GROUP_ORDER.filter((group) => rows.some((row) => row.group === group));

  if (rows.some((row) => row.skipped === true) === true) {
    usedGroups.push('skipped');
  }

  const legendCells = usedGroups.map((group, index) => {
    const color = group === 'skipped' ? SKIPPED_COLOR : GROUP_COLORS[group];
    const label = group === 'skipped' ? 'Not available on this build' : GROUP_LABELS[group];

    return `          <g class="cell" transform="translate(0, ${index * 20.5})">
            <rect class="swatch" height="15" width="15" style="fill: ${color};"/>
            <text class="label" transform="translate( 20, 12.5)" font-family="Arial, sans-serif" font-size="12px">
              <tspan x="0" dy="0em">${escapeXml(label)}</tspan>
            </text>
          </g>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" x="0" y="0" fill="#FFFFFF" id="background"/>
  <g id="viz">
    <g transform="translate(0,0)">
      <g transform="translate(${marginLeft},${marginTop})">
        <g class="bars">
${bars.join('\n')}
        </g>
        <g id="xAxis" transform="translate(0,${plotHeight})" fill="none" font-size="12" font-family="sans-serif" text-anchor="middle">
          <path class="domain" stroke="currentColor" d="M0,6V0H${plotWidth}V6"/>
${xTicks.join('\n')}
          <text font-family="Arial, sans-serif" font-size="12" x="${plotWidth}" dy="-5" fill="black" font-weight="bold" text-anchor="end">RPS</text>
        </g>
        <g id="yAxis" transform="translate(0,0)" fill="none" font-size="10" font-family="sans-serif" text-anchor="end">
          <path class="domain" stroke="currentColor" d="M0,0V${plotHeight}"/>
${yTicks.join('\n')}
        </g>
      </g>
    </g>
  </g>
  <g id="legend" transform="translate(${marginLeft + plotWidth + 40},${marginTop})">
    <g transform="translate(5,0)">
      <g class="legendColor" transform="translate(0,0)">
        <g class="legendCells" transform="translate(0,15.5)">
${legendCells}
        </g>
        <text class="legendTitle" font-family="Arial, sans-serif" font-size="12px" font-weight="bold">
          <tspan x="0" dy="0em">Pipeline</tspan>
        </text>
      </g>
    </g>
  </g>
</svg>
`;
}

/* ------------------------------------------------------------ table / csv */

function buildTable (rows) {
  const lines = [
    '| Sample | Template | Output | Converter | CPU | Avg latency | p95 | Throughput (RPS) |',
    '| ------ | -------- | ------ | --------- | --- | ----------- | --- | ---------------- |',
  ];

  for (const row of rows) {
    if (row.skipped === true) {
      lines.push(`| \`${row.sample}\` | ${row.template} | ${row.output} | ${row.converter} | ${row.cpu} | n/a | n/a | not available |`);
      continue;
    }

    lines.push(`| \`${row.sample}\` | ${row.template} | ${row.output} | ${row.converter} | ${row.cpu} | ${num(row.avg)}ms | ${num(row.p95)}ms | **${num(row.rps)}** |`);
  }

  return lines.join('\n');
}

function buildCsv (rows) {
  const header = ['Sample', 'Template', 'Output', 'Converter', 'CPU', 'Avg(ms)', 'p95(ms)', 'Max(ms)', 'RPS', 'Requests', 'Failures(%)', 'Label'];
  const lines = [header.map((cell) => `"${cell}"`).join(',')];

  for (const row of rows) {
    lines.push([
      row.sample,
      row.template,
      row.output,
      row.converter === '—' ? 'none' : row.converter,
      row.cpu,
      row.skipped === true ? '' : num(row.avg),
      row.skipped === true ? '' : num(row.p95),
      row.skipped === true ? '' : num(row.max),
      row.skipped === true ? '' : num(row.rps),
      row.skipped === true ? '' : row.requests,
      row.skipped === true ? '' : num(row.failures),
      row.label,
    ].map((cell) => `"${String(cell ?? '')}"`).join(','));
  }

  return `${lines.join('\n')}\n`;
}

function buildResultMd (rows, meta) {
  const parts = ['RESULT', '======', ''];

  parts.push('Generated by `npm run bench` — do not edit by hand.', '');

  if (rows.length === 0) {
    parts.push('No result yet. Run `npm run bench` (or `npm run bench:quick` for a 10s per run smoke test).', '');

    return parts.join('\n');
  }

  if (meta !== null) {
    parts.push('## Test environment', '');
    parts.push('| Item | Value |', '| ---- | ----- |');
    parts.push(`| Date | ${meta.finishedAt ?? meta.startedAt ?? 'unknown'} |`);
    parts.push(`| Carbone image | \`${meta.image}\` |`);
    parts.push(`| Factories (CPU) | ${(meta.cpus ?? []).join(', ')} |`);
    parts.push(`| Load | ${meta.vus} VUs during ${meta.duration} per run |`);
    parts.push(`| Host | ${meta.host?.cpu ?? 'unknown'} — ${meta.host?.cores ?? '?'} cores, ${meta.host?.memory ?? '?'} |`);
    parts.push(`| OS | ${meta.host?.platform ?? 'unknown'} |`);
    parts.push(`| k6 | ${meta.k6 ?? 'unknown'} |`);
    parts.push(`| Docker | ${meta.docker ?? 'unknown'} |`);
    parts.push('');
  }

  parts.push('## Summary', '', buildTable(rows), '');
  parts.push('## Detailed metrics', '');

  for (const row of rows) {
    parts.push(`### ${row.label}`, '');
    parts.push(`- template: \`${row.raw.templateFile}\``);
    parts.push(`- data: \`${row.raw.dataFile ?? '{}'}\``);
    parts.push(`- request: \`convertTo: ${row.raw.convertTo ?? 'none'}\`, \`converter: ${row.raw.converter ?? 'none'}\`, \`factories: ${row.cpu}\``);

    if (row.skipped === true) {
      parts.push('', `> Skipped: ${row.error}`, '');
      continue;
    }

    const latency = row.raw.metrics.latency;

    parts.push('');
    parts.push('```');
    parts.push(`requests ...........: ${row.requests} (${num(row.rps)}/s)`);
    parts.push(`failures ...........: ${num(row.failures)} %`);
    parts.push(`checks .............: ${row.raw.metrics.checks?.count ?? 0}`);
    parts.push(`latency ............: avg=${num(latency.avg)}ms min=${num(latency.min)}ms med=${num(latency.med)}ms max=${num(latency.max)}ms p(90)=${num(latency.p90)}ms p(95)=${num(latency.p95)}ms p(99)=${num(latency.p99)}ms`);
    parts.push(`data received ......: ${num((row.raw.metrics.dataReceived?.count ?? 0) / 1024 / 1024, 1)} MB`);
    parts.push(`data sent ..........: ${num((row.raw.metrics.dataSent?.count ?? 0) / 1024 / 1024, 1)} MB`);
    parts.push(`thresholds .........: ${row.raw.thresholdsPassed === true ? 'ok' : 'FAILED'}`);
    parts.push('```');
    parts.push('');
  }

  return `${parts.join('\n')}`;
}

function updateReadme (readmePath, rows, meta) {
  if (fs.existsSync(readmePath) === false) {
    return false;
  }

  const readme = fs.readFileSync(readmePath, 'utf8');
  const start = readme.indexOf(MARKER_START);
  const end = readme.indexOf(MARKER_END);

  if (start === -1 || end === -1) {
    return false;
  }

  const content = rows.length === 0
    ? '_No result yet — run `npm run bench`._'
    : [
      buildTable(rows),
      '',
      `_${rows.filter((row) => row.skipped === false).length} configurations measured with ${meta?.vus ?? '?'} VUs during ${meta?.duration ?? '?'} each, on \`${meta?.image ?? 'carbone-ee'}\`. Full details in [RESULT.md](RESULT.md)._`,
    ].join('\n');

  const updated = `${readme.slice(0, start + MARKER_START.length)}\n${content}\n${readme.slice(end)}`;

  fs.writeFileSync(readmePath, updated);

  return true;
}

/* -------------------------------------------------------------------- main */

export function generateReport ({ resultsDir = path.join(ROOT_DIR, 'results') } = {}) {
  const { meta, results } = readResults(resultsDir);
  const rows = toRows(results);

  const svgPath = path.join(ROOT_DIR, 'result.svg');
  const csvPath = path.join(resultsDir, 'results.csv');
  const resultMdPath = path.join(ROOT_DIR, 'RESULT.md');
  const readmePath = path.join(ROOT_DIR, 'README.md');

  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(svgPath, buildSvg(rows));
  fs.writeFileSync(csvPath, buildCsv(rows));
  fs.writeFileSync(resultMdPath, buildResultMd(rows, meta));

  const readmeUpdated = updateReadme(readmePath, rows, meta);

  process.stdout.write([
    '',
    'Report generated:',
    `  - ${path.relative(ROOT_DIR, svgPath)}`,
    `  - ${path.relative(ROOT_DIR, resultMdPath)}`,
    `  - ${path.relative(ROOT_DIR, csvPath)}`,
    readmeUpdated === true ? '  - README.md (summary table)' : '  - README.md skipped (BENCHMARK markers not found)',
    '',
  ].join('\n'));

  return { rows, meta };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const resultsDir = path.resolve(ROOT_DIR, process.argv[2] || 'results');

  generateReport({ resultsDir });
}
