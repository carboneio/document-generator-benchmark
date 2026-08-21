/**
 * k6 script benchmarking ONE Carbone configuration.
 *
 * It is not meant to be run by hand: `bench/run.mjs` prepares the request body
 * (template + data already base64-encoded, convertTo and converter set), starts
 * the Carbone container and calls this script once per matrix entry.
 *
 * Run it standalone with:
 *   CARBONE_PAYLOAD=.tmp/payload.json k6 run bench/carbone-bench.js
 *
 * Environment:
 *   CARBONE_PAYLOAD   path to the JSON body posted to Carbone   (required)
 *   CARBONE_URL       Carbone render endpoint                   (default http://127.0.0.1:4000/render/template?download=true)
 *   CARBONE_VUS       concurrent virtual users                  (default 10)
 *   CARBONE_DURATION  test duration                             (default 30s)
 *   CARBONE_MAX_P95   p(95) latency threshold in ms             (default 10000)
 *   CARBONE_LABEL     human readable name of the run            (default carbone)
 *   CARBONE_SUMMARY   path of the JSON summary to write         (optional)
 */

import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const PAYLOAD  = open(__ENV.CARBONE_PAYLOAD);
const URL      = __ENV.CARBONE_URL || 'http://127.0.0.1:4000/render/template?download=true';
const LABEL    = __ENV.CARBONE_LABEL || 'carbone';
const SUMMARY  = __ENV.CARBONE_SUMMARY || '';
const VUS      = Number(__ENV.CARBONE_VUS || 10);
const DURATION = __ENV.CARBONE_DURATION || '30s';
const MAX_P95  = Number(__ENV.CARBONE_MAX_P95 || 10000);

export const options = {
  vus                    : VUS,
  duration               : DURATION,
  // The server is what we measure: do not spend k6 CPU on response bodies
  discardResponseBodies  : true,
  summaryTrendStats      : ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds             : {
    http_req_failed  : ['rate<0.01'],
    carbone_latency  : [`p(95)<${MAX_P95}`],
  },
};

const carboneLatency = new Trend('carbone_latency', true);
const carboneErrors  = new Counter('carbone_errors');

const params = {
  headers : { 'Content-Type': 'application/json' },
  tags    : { run: LABEL },
};

export default function () {
  const res = http.post(URL, PAYLOAD, params);

  carboneLatency.add(res.timings.duration);

  if (res.status !== 200) {
    carboneErrors.add(1);
  }

  check(res, {
    'status is 200'  : (r) => r.status === 200,
    'duration < 30s' : (r) => r.timings.duration < 30000,
  });
}

function trend (metrics, name) {
  const values = (metrics[name] || {}).values || {};

  return {
    avg : values.avg ?? null,
    min : values.min ?? null,
    med : values.med ?? null,
    max : values.max ?? null,
    p90 : values['p(90)'] ?? null,
    p95 : values['p(95)'] ?? null,
    p99 : values['p(99)'] ?? null,
  };
}

function counter (metrics, name) {
  const values = (metrics[name] || {}).values || {};

  return { count: values.count ?? 0, rate: values.rate ?? 0 };
}

function thresholdsOf (metrics) {
  const result = {};

  for (const [name, metric] of Object.entries(metrics)) {
    for (const [expression, outcome] of Object.entries(metric.thresholds || {})) {
      result[`${name}: ${expression}`] = outcome.ok !== false;
    }
  }

  return result;
}

function fixed (value, digits = 2) {
  return typeof value === 'number' ? value.toFixed(digits) : 'n/a';
}

export function handleSummary (data) {
  const metrics    = data.metrics;
  const latency    = trend(metrics, 'http_req_duration');
  const requests   = counter(metrics, 'http_reqs');
  const failed     = (metrics.http_req_failed || {}).values || {};
  const thresholds = thresholdsOf(metrics);
  const allOk      = Object.values(thresholds).every((ok) => ok === true);

  const summary = {
    label      : LABEL,
    url        : URL,
    vus        : VUS,
    duration   : DURATION,
    finishedAt : new Date().toISOString(),
    metrics    : {
      latency           : latency,
      carboneLatency    : trend(metrics, 'carbone_latency'),
      iterationDuration : trend(metrics, 'iteration_duration'),
      requests          : requests,
      iterations        : counter(metrics, 'iterations'),
      rps               : requests.rate,
      failureRate       : failed.rate ?? 0,
      errors            : counter(metrics, 'carbone_errors').count,
      checks            : counter(metrics, 'checks'),
      dataReceived      : counter(metrics, 'data_received'),
      dataSent          : counter(metrics, 'data_sent'),
    },
    thresholds        : thresholds,
    thresholdsPassed  : allOk,
  };

  const stdout = [
    '',
    `  ── ${LABEL}`,
    `     requests ...... ${requests.count} (${fixed(requests.rate)} RPS)`,
    `     latency avg ... ${fixed(latency.avg)} ms`,
    `     latency p95 ... ${fixed(latency.p95)} ms`,
    `     failures ...... ${fixed((failed.rate ?? 0) * 100)} %`,
    `     thresholds .... ${allOk === true ? 'ok' : 'FAILED'}`,
    '',
  ].join('\n');

  const output = { stdout: stdout };

  if (SUMMARY !== '') {
    output[SUMMARY] = JSON.stringify(summary, null, 2);
  }

  return output;
}
