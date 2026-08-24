# 📊 Carbone Document Generator Benchmark

> **How fast does Carbone generate documents?** Real templates, real data, with and without PDF conversion, on 1 or 4 CPU.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Benchmark](https://img.shields.io/badge/benchmark-k6-orange.svg)](https://k6.io)
[![Carbone](https://img.shields.io/badge/carbone-5.14.0-A644C5.svg)](https://carbone.io)

This repository measures the throughput and the latency of [**Carbone**](https://carbone.io) on a matrix of real document generation jobs. For every template of the [`samples/`](samples) folder, Carbone merges a JSON dataset into the template and, optionally, converts the result to PDF — with **1** or **4** conversion workers, and **10** concurrent users by default. HTML and DOCX are reported separately: their throughputs are not comparable.

Everything is reproducible with a single command: `npm run bench`.

---

## 🎯 Results

The public report is a **dated static HTML page**: one summary, then one section per template. Each template shows two modes: **Merge only** (same format) and **Convert to PDF**. Converters compete on that template only. 1 CPU vs 4 CPU is a scaling table, not a race. HTML and DOCX stay apart.

Latest: [docs/index.html](docs/index.html) · [previous benchmarks](docs/index.html#history)

<!-- BENCHMARK:RESULTS:START -->
Latest report: **[2026-08-22 08:50:10 UTC](docs/index.html)** · [previous benchmarks](docs/index.html#history)

| Template sample | Merge only @ 4 CPU (RPS) | Convert to PDF @ 4 CPU (RPS) |
| --------------- | --------------------------- | ------------------------------- |
| [`financial_chart`](docs/index.html#financial-chart-docx-1) | DOCX → DOCX **178.5** | **126.1** · DOCX → PDF (fastest: Carbone ICE) |
| [`invoice_simple`](docs/index.html#invoice-simple-docx-1) | DOCX → DOCX **288.7** | **172.9** · DOCX → PDF (fastest: Carbone ICE) |
| [`ticket_qrcode`](docs/index.html#ticket-qrcode-docx-1) | DOCX → DOCX **70.3** | **63.5** · DOCX → PDF (fastest: Carbone ICE) |
| [`invoice_simple`](docs/index.html#invoice-simple-html-1) | HTML → HTML **1202.8** | **329.4** · HTML → PDF (fastest: Chromium) |
<!-- BENCHMARK:RESULTS:END -->

Raw k6 metrics of the latest campaign: [RESULT.md](RESULT.md). The HTML pages in [`docs/`](docs) are meant to be committed (dated snapshot + `index.html`).

---

## 🔬 What is measured

Each sample is a **template + JSON data** pair. Carbone always merges the data into the template; the PDF conversion is an extra step handled by a dedicated engine:

| Pipeline | `convertTo` | `converter` | Engine |
| -------- | ----------- | ----------- | ------ |
| Merge only (DOCX → DOCX, HTML → HTML) | – | – | Carbone template engine only |
| DOCX → PDF | `pdf` | `I` | Carbone ICE (Instant Converter Engine, since 5.14.0) |
| Office template → PDF | `pdf` | `L` | LibreOffice |
| Office template → PDF | `pdf` | `O` | OnlyOffice |
| Web template → PDF | `pdf` | `C` | Chromium |

The matrix is the cartesian product of:

- **the samples** found in `samples/` (auto-discovered)
- **the pipelines** relevant to the template format (DOCX gets LibreOffice, OnlyOffice *and* Carbone ICE; other office templates get LibreOffice and OnlyOffice; web templates get Chromium)
- **the number of Carbone factories**: `1` and `4` (`carbone webserver -f <n>`, one worker per CPU)
- **the concurrency**: `10` k6 virtual users by default (`--vus` to change it)

With the samples currently committed, that is **28 runs**. Print the plan without running anything:

```bash
npm run plan
```

### Samples

| Template | Data | Formats benchmarked |
| -------- | ---- | ------------------- |
| `template_incoice_simple.docx` | `template_incoice_simple.json` | merge only, PDF (LibreOffice, OnlyOffice, Carbone ICE) |
| `template_incoice_simple.html` | `template_incoice_simple.json` | merge only, PDF (Chromium) |
| `template_chart.docx` | `template_chart.json` | merge only, PDF (LibreOffice, OnlyOffice, Carbone ICE) |
| `template_qrcode.docx` | `template_qrcode.json` | merge only, PDF (LibreOffice, OnlyOffice, Carbone ICE) |

Adding a sample requires **no code change**: drop `my_template.docx` and `my_template.json` into `samples/` and they are picked up on the next run. A template without a matching `.json` is rendered with an empty dataset.

To benchmark the **same template at several sizes** (1 / 100 / 1000 pages), suffix the basename with `_100p` or `_1000p`:

```
template_invoice.docx      + template_invoice.json        → 1 page
template_invoice_100p.docx + template_invoice_100p.json   → 100 pages
template_invoice_1000p.docx + template_invoice_1000p.json → 1000 pages
```

The report groups them as one family and labels the page count. They are never mixed on the same converter chart.

---

## 🚀 Getting started

### Prerequisites

- [Docker](https://www.docker.com/get-started) — runs the Carbone server
- [k6](https://k6.io) — generates the load
- [Node.js](https://nodejs.org) ≥ 18 — orchestrates the runs and builds the report (no npm dependency to install)

```bash
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D53
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Windows
choco install k6
```

### Run the full benchmark

```bash
npm run bench
```

The runner does everything: it starts `carbone/carbone-ee:full-5.14.0` with `-f 1`, plays all the samples, restarts the container with `-f 4`, plays them again, removes the container, then writes one chart and one table per source template type, plus the CSV.

The container is started with the same command as the [manual one](#-running-carbone-by-hand), only detached and named: `docker run -d --name carbone-bench -p 4000:4000 <image> webserver -s -f <n>`. Extra flags are opt-in (`--env`, `--shm-size`, `--docker-cpus`), and the exact command is printed before each start.

### Or start Carbone yourself

If you prefer to control the container (custom flags, remote server, debugging), start it and point the runner at it with `--no-docker`. One factory count per server, since the runner cannot restart it:

```bash
docker run -t -i --rm -p 4000:4000 carbone/carbone-ee:full-5.14.0 webserver -s -f 4
node bench/run.mjs --no-docker --cpus 4
```

Both modes write to the same `results/` folder, so you can run `--cpus 1` and `--cpus 4` in two passes and still get one complete report.

Expect roughly **20 minutes** with the default settings (28 runs × 30s + warmups + container restarts).

```bash
npm run bench:quick          # same matrix, 10s per run, to validate the setup first
npm run report               # rebuild docs/index.html, the dated snapshot, RESULT.md and CSV
```

### Options

Every option is a CLI flag, or the matching `CARBONE_*` environment variable.

| Flag | Env variable | Default | Description |
| ---- | ------------ | ------- | ----------- |
| `--cpus <list>` | `CARBONE_CPUS` | `1,4` | Number of Carbone factories to benchmark |
| `--duration <time>` | `CARBONE_DURATION` | `30s` | k6 duration per run |
| `--vus <n>` | `CARBONE_VUS` | `10` | Concurrent virtual users |
| `--filter <text>` | – | – | Only run matrix entries whose id or label contains `<text>` |
| `--image <image>` | `CARBONE_IMAGE` | `carbone/carbone-ee:full-5.14.0` | Carbone Docker image |
| `--port <port>` | `CARBONE_PORT` | `4000` | Host port bound to the container |
| `--container <name>` | `CARBONE_CONTAINER` | `carbone-bench` | Container name |
| `--docker-cpus <n>` | `CARBONE_DOCKER_CPUS` | – | Also cap the container to `n` host CPUs |
| `--license-file <f>` | `CARBONE_LICENSE_FILE` | – | Mount an enterprise license file into the container |
| `--env KEY=VALUE` | – | – | Extra environment variable for the container (repeatable) |
| `--shm-size <size>` | `CARBONE_SHM_SIZE` | – | `/dev/shm` size, ex `1g` — Chromium and LibreOffice like it |
| `--startup-timeout <s>` | `CARBONE_STARTUP_TIMEOUT` | `120` | How long to wait for Carbone to listen |
| `--request-timeout <s>` | `CARBONE_REQUEST_TIMEOUT` | `60` | Give up on a warmup render after n seconds |
| `--warmup <n>` | `CARBONE_WARMUP` | `3` | Valid renders required before measuring |
| `--warmup-retries <n>` | `CARBONE_WARMUP_RETRIES` | `3` | Extra warmup attempts allowed on connection reset |
| `--cooldown <sec>` | `CARBONE_COOLDOWN` | `3` | Pause between runs |
| `--results <dir>` | `CARBONE_RESULTS` | `results` | Where JSON results are written |
| `--no-docker` | – | – | Do not manage Docker, use an already running Carbone |
| `--keep` | – | – | Leave the container running at the end |
| `--dry-run` | – | – | Print the plan and exit |

Examples:

```bash
# Only the invoice sample, 4 CPU, 1 minute per run
node bench/run.mjs --filter incoice --cpus 4 --duration 1m

# Benchmark a Carbone server you started yourself on port 4001
node bench/run.mjs --no-docker --port 4001 --cpus 4

# Compare 1, 2, 4 and 8 factories, or raise the load
node bench/run.mjs --cpus 1,2,4,8
node bench/run.mjs --vus 50
```

### Enterprise license

The runner forwards the license to the container by itself. Use whichever form you already have:

```bash
# v5 environment variable
export CARBONE_LICENSE=$(cat my_license.carbone-license)
npm run bench

# legacy environment variable, still accepted by Carbone
export CARBONE_EE_LICENSE=$(cat my_license.carbone-license)
npm run bench

# or mount the license file, no export needed
node bench/run.mjs --license-file ./my_license.carbone-license
```

`CARBONE_LICENSE` and `CARBONE_EE_LICENSE` are forwarded with `docker run -e <name>`, so the key never appears in the printed command line. `--license-file` mounts the file read-only in the container `config/` directory. The line `license .......` in the runner header tells you which one was picked up.

---

## 🧪 Running Carbone by hand

Useful to check a configuration before launching the whole benchmark.

### 1. Start Carbone

```bash
# 1 worker
docker run -t -i --rm -p 4000:4000 carbone/carbone-ee:full-5.14.0 webserver -s -f 1

# 4 workers
docker run -t -i --rm -p 4000:4000 carbone/carbone-ee:full-5.14.0 webserver -s -f 4
```

### 2. Upload a template

Like the benchmark does: the template is stored once, and every document is then generated from its `templateVersionId`.

```bash
cd samples
mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
template=$(base64 < template_incoice_simple.docx | tr -d '\r\n')

curl -s -H 'Content-Type: application/json' \
  -d "{\"versioning\":true,\"template\":\"data:${mime};base64,${template}\"}" \
  'http://localhost:4000/template'
# {"success":true,"data":{"id":"...","versionId":"914593af…","type":"docx", ...}}

id=914593af…   # the versionId returned above
```

### 3. Generate one document

```bash
data=$(cat template_incoice_simple.json)

# Merge only, no conversion
curl -s -H 'Content-Type: application/json' \
  -d "{\"data\":${data}}" \
  "http://localhost:4000/render/${id}?download=true" --output out.docx

# DOCX to PDF with LibreOffice ("L"), OnlyOffice ("O"), or Carbone ICE ("I")
curl -s -H 'Content-Type: application/json' \
  -d "{\"data\":${data},\"convertTo\":\"pdf\",\"converter\":\"I\"}" \
  "http://localhost:4000/render/${id}?download=true" --output out-ice.pdf
```

### 4. Run a single k6 test

`bench/carbone-bench.js` reads a ready-made request body, so it can be replayed on its own:

```bash
CARBONE_URL="http://localhost:4000/render/${id}?download=true" \
CARBONE_PAYLOAD=./payload.json CARBONE_VUS=10 CARBONE_DURATION=30s k6 run bench/carbone-bench.js
```

---

## 📁 How it works

| File | Role |
| ---- | ---- |
| [`bench/matrix.mjs`](bench/matrix.mjs) | Discovers the samples, builds the run matrix, builds the Carbone request body |
| [`bench/carbone-bench.js`](bench/carbone-bench.js) | k6 script measuring **one** configuration, exports a JSON summary |
| [`bench/run.mjs`](bench/run.mjs) | Orchestrator: container lifecycle, template upload, warmup, k6 runs, JSON results |
| [`bench/html.mjs`](bench/html.mjs) | Builds the dated public HTML page (summary + one section per template) |
| [`bench/report.mjs`](bench/report.mjs) | Writes `docs/<date>.html`, `docs/index.html`, `RESULT.md`, CSV and the README summary |
| `results/` | One JSON file per run + `index.json` (all runs and the test environment) |

Before measuring, the runner renders each configuration until it gets 3 **valid** documents (a PDF must start with `%PDF`, an office document with `PK`). This spawns the LibreOffice / OnlyOffice / Chromium workers before the load starts.

Carbone sometimes resets the connection on the very first render of a kind, while those workers are still spawning. Such failures are retried — a run is skipped only when Carbone never produced a valid document, and the reason is then reported instead of polluting the results.

Each template is uploaded once with `POST /template`, before the measures, so a measured request only carries its JSON dataset. That body is built once by Node and posted verbatim by k6: no base64 encoding, no JSON serialization and no template upload happens inside the load generator — the measured time is Carbone's.

---

## 📊 Methodology

- **Load tool**: [k6](https://k6.io), 10 virtual users, 30s per configuration (both configurable)
- **Endpoint**: `POST /render/:templateVersionId?download=true`, the document is generated *and* downloaded in one call
- **Metrics**: average / median / p90 / p95 / p99 latency, throughput (RPS), failure rate
- **Warmup**: 3 renders per configuration, excluded from the measures
- **Response bodies** are discarded by k6 (`discardResponseBodies`) to keep the load generator cheap
- **Thresholds**: `http_req_failed < 1%` and `p(95) < 10s`; a crossed threshold is reported but the measures are kept

The exact environment (host CPU, Docker and k6 versions, image, date) is recorded in `results/index.json` and printed in [RESULT.md](RESULT.md).

> ⚠️ Benchmarks measure a single Carbone container on a single machine. Absolute numbers depend on your hardware. The HTML report compares **converters on the same template**; 1 vs 4 CPU is shown as scaling, not as a ranking. A later phase can add competing products as extra engines on the same per-template chart (`vendor` is already on every run).

### Troubleshooting

- **Carbone ICE rows reported as “not available”**: Carbone ICE requires **5.14.0** or later, and only converts DOCX to PDF. Use `--image carbone/carbone-ee:full-5.14.0` (the default).
- **OnlyOffice rows reported as “not available”**: the converter is disabled in the image you used. Point Carbone to the binaries with `CARBONE_ONLY_OFFICE_PATH` (`"x2tPath, AllFontsPath, fontPath"`), or use an image that bundles it.
- **Chromium rows reported as “not available”**: same idea with `CARBONE_CHROME_PATH`.
- **Container exits during startup**: the runner stops right away and prints the container logs — usually an invalid or expired license, or a port already in use.

---

## 🤝 Contributing

Contributions are welcome: add samples, refine the methodology, improve the report. Feel free to open an issue or a pull request.

## 📄 License

Apache License 2.0 — see [LICENSE](LICENSE).

**Made with ❤️ for the open-source community**
