/**
 * k6 script benchmarking ONE Carbone configuration.
 *
 * It is not meant to be run by hand: `bench/run.mjs` starts the Carbone
 * container, uploads the template, prepares the request body (data, convertTo
 * and converter) and calls this script once per matrix entry.
 *
 * Run it standalone with:
 *   CARBONE_URL=http://127.0.0.1:4000/render/<templateVersionId>?download=true \
 *   CARBONE_PAYLOAD=.tmp/payload.json k6 run bench/carbone-bench.js
 *
 * Environment:
 *   CARBONE_PAYLOAD   path to the JSON body posted to Carbone   (required)
 *   CARBONE_URL       POST /render/:templateVersionId endpoint   (required)
 *   CARBONE_VUS       concurrent virtual users                  (default 10)
 *   CARBONE_RENDERS   documents to generate per virtual user    (default 100)
 *   CARBONE_MAX_DURATION  give up after that long              (default 60s)
 *   CARBONE_TIMEOUT   give up on a single render after that     (default 120s)
 *   CARBONE_MAX_P95   p(95) latency threshold in ms             (default 10000)
 *   CARBONE_LABEL     human readable name of the run            (default carbone)
 *   CARBONE_SUMMARY   path of the JSON summary to write         (optional)
 */

import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const PAYLOAD  = open(__ENV.CARBONE_PAYLOAD);
// The template lives on the server now, so the URL carries its id: there is no
// sensible default to fall back on
const URL      = __ENV.CARBONE_URL;
const LABEL    = __ENV.CARBONE_LABEL || 'carbone';
const SUMMARY  = __ENV.CARBONE_SUMMARY || '';
const VUS      = Number(__ENV.CARBONE_VUS || 10);
const RENDERS  = Number(__ENV.CARBONE_RENDERS || 100);
const MAX_TIME = __ENV.CARBONE_MAX_DURATION || '60s';
const TIMEOUT  = __ENV.CARBONE_TIMEOUT || '120s';
const MAX_P95  = Number(__ENV.CARBONE_MAX_P95 || 10000);

if (!URL) {
  throw new Error('CARBONE_URL is required, ex: http://127.0.0.1:4000/render/<templateVersionId>?download=true');
}

export const options = {
  scenarios : {
    // A fixed number of documents per user rather than a fixed duration: a
    // 200 page PDF and a one page merge are then measured on the same amount of
    // work. `per-vu-iterations` keeps the concurrency constant to the end, where
    // `shared-iterations` would let the fast users starve the others.
    carbone : {
      executor     : 'per-vu-iterations',
      vus          : VUS,
      iterations   : RENDERS,
      maxDuration  : MAX_TIME,
      // Enough for a render in flight to finish instead of being counted as failed
      gracefulStop : '60s',
    },
  },
  // The server is what we measure: do not spend k6 CPU on response bodies
  discardResponseBodies  : true,
  summaryTrendStats      : ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds             : {
    http_req_failed  : ['rate<0.01'],
    carbone_latency  : [`p(95)<${MAX_P95}`],
  },
};

const carboneLatency  = new Trend('carbone_latency', true);
const carboneErrors   = new Counter('carbone_errors');
const carboneTimeouts = new Counter('carbone_timeouts');

const params = {
  headers : { 'Content-Type': 'application/json' },
  tags    : { run: LABEL },
  timeout : TIMEOUT,
};

/**
 * A pipeline that cannot deliver one document within the timeout is out of
 * scale: measuring it again would only cost minutes, so the virtual user stops
 * asking. k6 gives each of them its own module scope, which is exactly the
 * granularity wanted here.
 */
let outOfScale = false;

/** k6 reports a timed out request as status 0 with error code 1050. */
function isTimeout (res) {
  return res.error_code === 1050 || /timeout|deadline exceeded/i.test(res.error || '');
}

export default function () {
  if (outOfScale === true) {
    return;
  }

  const res = http.post(URL, PAYLOAD, params);

  if (isTimeout(res) === true) {
    outOfScale = true;
    carboneTimeouts.add(1);
    carboneErrors.add(1);

    return;
  }

  carboneLatency.add(res.timings.duration);

  if (res.status !== 200) {
    carboneErrors.add(1);
  }

  check(res, { 'status is 200': (r) => r.status === 200 });
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

  const timeouts = counter(metrics, 'carbone_timeouts').count;

  const summary = {
    label       : LABEL,
    url         : URL,
    vus         : VUS,
    renders     : RENDERS,
    maxDuration : MAX_TIME,
    timeout     : TIMEOUT,
    // No document within the timeout: the report shows it as out of scale
    // instead of publishing the timeout itself as a duration
    outOfScale  : timeouts > 0 && requests.count <= timeouts,
    finishedAt  : new Date().toISOString(),
    metrics    : {
      latency           : latency,
      carboneLatency    : trend(metrics, 'carbone_latency'),
      iterationDuration : trend(metrics, 'iteration_duration'),
      requests          : requests,
      iterations        : counter(metrics, 'iterations'),
      rps               : requests.rate,
      failureRate       : failed.rate ?? 0,
      errors            : counter(metrics, 'carbone_errors').count,
      timeouts          : timeouts,
      checks            : counter(metrics, 'checks'),
      dataReceived      : counter(metrics, 'data_received'),
      dataSent          : counter(metrics, 'data_sent'),
    },
    thresholds        : thresholds,
    thresholdsPassed  : allOk,
  };

  const stdout = summary.outOfScale === true
    ? [
      '',
      `  ── ${LABEL}`,
      `     out of scale .. no document within ${TIMEOUT}, stopped after the first render`,
      '',
    ].join('\n')
    : [
      '',
      `  ── ${LABEL}`,
      `     documents ..... ${requests.count} of ${RENDERS * VUS} asked (${fixed(requests.rate)} RPS)`,
      `     latency med ... ${fixed(latency.med)} ms`,
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
