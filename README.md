# 📊 Carbone Document Generator Benchmark

> **How fast does Carbone generate documents?** Real templates, real data, with and without PDF conversion, one document at a time and under load.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Benchmark](https://img.shields.io/badge/benchmark-k6-orange.svg)](https://k6.io)
[![Carbone](https://img.shields.io/badge/carbone-5.14.0-A644C5.svg)](https://carbone.io)

This repository measures the throughput and the latency of [**Carbone**](https://carbone.io) on a matrix of real document generation jobs. For every template of the [`samples/`](samples) folder, Carbone merges a JSON dataset into the template and, optionally, converts the result to PDF — on **1** or **4** conversion factories (`webserver -f`), which the report reads as **1 CPU** and **4 CPU**.

Every pipeline is measured twice, because two different questions are worth answering:

| Measure | How | What it answers |
| ------- | --- | --------------- |
| **One document at a time** | `1 CPU · 1 VU` — one request in flight, nothing waiting in a queue | how long Carbone needs to produce this document |
| **Under load** | `4 CPU · 5 VU` — five requests in flight, one more than the number of CPUs | how many documents the server delivers per minute |

A **VU** is a *virtual user*, sending one request after the other. A latency measured under load is a queue length in disguise — with a fixed number of virtual users, it is the throughput written in another unit — so the one document at a time run is the only one that really times a document. A large dataset per template adds a **`Pages/s`** figure, which puts a one page invoice and a two hundred page report on the same scale. HTML and DOCX are reported separately: their throughputs are not comparable.

Everything is reproducible with a single command: `npm run bench`.

---

## 🎯 Results

The public report is a **dated static HTML page**: one card per template, each with a preview of the document and a single table. The two first columns give the **`Doc/min`** delivered at `1 CPU · 1 VU` and at `4 CPU · 5 VU`, the smaller figure below being the **p95 latency** of the same run — under load it includes the queue wait time. The last column gives the **`Pages/s`**, the page generation speed of one large document processed alone on a single CPU, which is what makes a one page invoice comparable with a several hundred page report. The merge sits on its own row, apart and without a bar: it does not go through the conversion factories. Converters compete on their template only, and HTML and DOCX stay apart.

Latest: [docs/index.html](docs/index.html) · [previous benchmarks](docs/index.html#history)

<!-- BENCHMARK:RESULTS:START -->
Latest report: **[2026-08-27 20:56:21 UTC](docs/index.html)** · [previous benchmarks](docs/index.html#history)

| Template sample | Merge only (Doc/min) | Convert to PDF (Doc/min) | Pages/s |
| --- | --- | --- | --- |
| [`financial_chart`](docs/index.html#financial-chart-docx) | DOCX → DOCX **9,317** | **5,348** · DOCX → PDF (fastest: Carbone ICE) | **25** on 1 page (Carbone ICE) |
| [`invoice_simple`](docs/index.html#invoice-simple-docx) | DOCX → DOCX **16,732** | **8,238** · DOCX → PDF (fastest: Carbone ICE) | **154** on 234 pages (Carbone ICE) |
| [`ticket_qrcode`](docs/index.html#ticket-qrcode-docx) | DOCX → DOCX **4,268** | **3,514** · DOCX → PDF (fastest: Carbone ICE) | **24** on 1 page (Carbone ICE) |
| [`invoice_simple`](docs/index.html#invoice-simple-html) | HTML → HTML **47,451** | **19,061** · HTML → PDF (fastest: Chromium) | **92** on 234 pages (Chromium) |

Both throughputs at **4 CPU · 5 VU**, pages per second on one document alone at **1 CPU · 1 VU**. The [report page](docs/index.html) adds the 1 CPU · 1 VU throughput, the p95 latency of every column and a preview of each document.
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

Each pipeline — one sample, one dataset, one output format, one converter — is played under two **profiles**, which is also the number of times Carbone is started:

| Profile | Factories (CPU) | Virtual users (VU) | Work | Reported as |
| ------- | --------------- | ------------------ | ---- | ----------- |
| `solo` | 1 | 1 | 10 documents | the `1 CPU · 1 VU` column, and every `Pages/s` |
| `load` | 4 | 5 | 100 documents per user, 60s max | the `4 CPU · 5 VU` column |

Five virtual users on four CPU — one more request in flight than the server can handle at once: enough to keep every factory busy, not enough to turn the measure into a queue length.

The pipelines themselves come from the samples found in `samples/` (auto-discovered) and the converters relevant to their format: DOCX gets LibreOffice, OnlyOffice *and* Carbone ICE, other office templates get LibreOffice and OnlyOffice, web templates get Chromium.

Every run stops on a **fixed amount of work**, not on a fixed clock, so a slow engine is measured on the same number of documents as a fast one; `maxDuration` is only a safety net for an engine too slow to finish. A document of more than **100 pages** is measured one at a time only, **3 times**, without warmup, and a single render is abandoned after **120s** — the report then shows `∞` instead of a duration. With the samples currently committed, that is around **35 runs**. Print the plan without running anything:

```bash
npm run plan
```

### Samples

| Template | Data | Card on the report | Formats benchmarked |
| -------- | ---- | ------------------ | ------------------- |
| `template_invoice_simple.docx` | `template_invoice_simple.json` + `_234p.json` | `invoice_simple` DOCX | merge only, PDF (LibreOffice, OnlyOffice, Carbone ICE) |
| `template_invoice_simple.html` | the same two datasets | `invoice_simple` HTML | merge only, PDF (Chromium) |
| `template_chart.docx` | `template_chart.json` | `financial_chart` | merge only, PDF (LibreOffice, OnlyOffice, Carbone ICE) |
| `template_qrcode.docx` | `template_qrcode.json` | `ticket_qrcode` | merge only, PDF (LibreOffice, OnlyOffice, Carbone ICE) |

A card is named after what the document is, not after its file: `template_chart.docx` is a financial report, `template_qrcode.docx` an event ticket.

Adding a sample requires **no code change**: drop `my_template.docx` and `my_template.json` into `samples/` and they are picked up on the next run. A template without a matching `.json` is rendered with an empty dataset.

### Large documents, and pages per second

A one page invoice says nothing about a two hundred page report: the merge grows with the data, the conversion grows with the layout. So a template can carry a **second dataset**, suffixed with the number of pages the generated document has:

```
template_invoice_simple.docx  +  template_invoice_simple.json        →     1 page
                                 template_invoice_simple_234p.json   →   234 pages
```

Both are measured, and the large one feeds the **`Pages/s`** column of the report — the unit that lets a small document and a large one be compared. A large document is only measured one at a time: under load, its duration would say more about the queue than about the document.

Writing a 234 page dataset by hand is no fun, so `bench/grow-sample.mjs` does it. Ask it for a number of **pages** and the array to grow:

```bash
# at least 200 pages of invoice, growing d.products
node bench/grow-sample.mjs samples/template_invoice_simple.json 200 d.products

# the dataset is the array itself in this sample: grow `d`
node bench/grow-sample.mjs samples/template_qrcode.json 200 d
```

```
Growing "d.products" of template_invoice_simple.json until the document has at least 200 pages
  template_invoice_simple.docx → PDF with Carbone ICE, Carbone on port 4000

     200 entries → 63 pages
     650 entries → 205 pages  ✔

✔ 205 pages with 650 entries, in 2 renders
  649 entries randomized out of the first one, images replaced by mono-color pictures
  samples/template_invoice_simple_205p.json — 1.10 MB
  .tmp/template_invoice_simple_205p.pdf — 2.30 MB, open it to check the result
```

It starts with as many entries as pages asked, renders the PDF with Carbone, counts its pages, then scales the entry count up until it passes the target — 2 to 3 renders in practice, since the page count grows almost linearly. The file is named after the page count actually obtained, never after the target, so the report never claims a size the document does not have. Added entries are copies of the first one with randomized content: same shape, same types, same string lengths, and images replaced by mono-color pictures (a solid PNG weighs a few hundred bytes, where the original photo weighs 30 KB).

The PDF is kept in `.tmp/` to be checked. **Carbone must be running**, since the page count of a document can only be known by generating it. Pages are counted on the DOCX with Carbone ICE by default: `--template` picks another template when several share the dataset, `--converter L` another engine, and `--port` another server.

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

The runner does everything: it starts `carbone/carbone-ee:full-5.14.0` with `-f 1`, plays all the samples one document at a time, restarts the container with `-f 4`, plays them again with 5 virtual users, removes the container, then writes the HTML report, `RESULT.md` and the CSV.

The container is started with the same command as the [manual one](#-running-carbone-by-hand), only detached and named: `docker run -d --name carbone-bench -p 4000:4000 <image> webserver -s -f <n>`. Extra flags are opt-in (`--env`, `--shm-size`, `--docker-cpus`), and the exact command is printed before each start.

### Or start Carbone yourself

If you prefer to control the container (custom flags, remote server, debugging), start it and point the runner at it with `--no-docker`. One factory count per server, since the runner cannot restart it:

```bash
docker run -t -i --rm -p 4000:4000 carbone/carbone-ee:full-5.14.0 webserver -s -f 4
node bench/run.mjs --no-docker --cpus 4
```

Both modes write to the same `results/` folder, so you can run `--cpus 1` and `--cpus 4` in two passes and still get one complete report. Add `--no-solo` to the second pass: timing a single document twice measures the same thing.

Expect roughly **30 minutes** with the default settings (35 runs + warmups + container restarts).

```bash
npm run bench:quick          # same matrix, a handful of documents per run, to validate the setup first
npm run report               # rebuild docs/index.html, the dated snapshot, RESULT.md and CSV
```

### Options

Every option is a CLI flag, or the matching `CARBONE_*` environment variable.

| Flag | Env variable | Default | Description |
| ---- | ------------ | ------- | ----------- |
| `--cpus <list>` | `CARBONE_CPUS` | `1,4` | Number of Carbone factories to benchmark |
| `--vus <n>` | `CARBONE_VUS` | `5` | Concurrent virtual users of the load profile |
| `--renders <n>` | `CARBONE_RENDERS` | `100` | Documents per virtual user under load |
| `--solo-renders <n>` | `CARBONE_SOLO_RENDERS` | `10` | Documents of the `solo` profile |
| `--max-duration <time>` | `CARBONE_MAX_DURATION` | `60s` | Safety net: give up a run after that |
| `--no-solo` | – | – | Skip the `solo` profile |
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
| `--warmup <n>` | `CARBONE_WARMUP` | `3` | Valid renders required before measuring, ignored on documents over 100 pages |
| `--warmup-retries <n>` | `CARBONE_WARMUP_RETRIES` | `3` | Extra warmup attempts allowed on connection reset |
| `--cooldown <sec>` | `CARBONE_COOLDOWN` | `3` | Pause between runs |
| `--results <dir>` | `CARBONE_RESULTS` | `results` | Where JSON results are written |
| `--no-docker` | – | – | Do not manage Docker, use an already running Carbone |
| `--keep` | – | – | Leave the container running at the end |
| `--dry-run` | – | – | Print the plan and exit |

Examples:

```bash
# Only the invoice sample, 4 CPU, 300 documents per user
node bench/run.mjs --filter invoice --cpus 4 --renders 300

# Benchmark a Carbone server you started yourself on port 4001
node bench/run.mjs --no-docker --port 4001 --cpus 4

# Compare 1, 2, 4 and 8 factories, or raise the load
node bench/run.mjs --cpus 1,2,4,8
node bench/run.mjs --vus 4 --renders 30
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
template=$(base64 < template_invoice_simple.docx | tr -d '\r\n')

curl -s -H 'Content-Type: application/json' \
  -d "{\"versioning\":true,\"template\":\"data:${mime};base64,${template}\"}" \
  'http://localhost:4000/template'
# {"success":true,"data":{"id":"...","versionId":"914593af…","type":"docx", ...}}

id=914593af…   # the versionId returned above
```

### 3. Generate one document

```bash
data=$(cat template_invoice_simple.json)

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
CARBONE_PAYLOAD=./payload.json CARBONE_VUS=5 CARBONE_RENDERS=100 \
CARBONE_MAX_DURATION=60s CARBONE_TIMEOUT=120s k6 run bench/carbone-bench.js
```

---

## 📁 How it works

| File | Role |
| ---- | ---- |
| [`bench/matrix.mjs`](bench/matrix.mjs) | Discovers the samples, builds the run matrix, builds the Carbone request body |
| [`bench/carbone-bench.js`](bench/carbone-bench.js) | k6 script measuring **one** configuration, exports a JSON summary |
| [`bench/run.mjs`](bench/run.mjs) | Orchestrator: container lifecycle, template upload, warmup, k6 runs, JSON results |
| [`bench/html.mjs`](bench/html.mjs) | Builds the dated public HTML page (one card per template) and the README summary table |
| [`bench/report.mjs`](bench/report.mjs) | Writes `docs/<date>.html`, `docs/index.html`, `RESULT.md`, CSV and the README summary |
| [`bench/grow-sample.mjs`](bench/grow-sample.mjs) | Standalone: grows a dataset until the document reaches a page count |
| `results/` | One JSON file per run + `index.json` (all runs and the test environment) |

Before measuring, the runner renders each pipeline until it gets 3 **valid** documents (a PDF must start with `%PDF`, an office document with `PK`). This spawns the LibreOffice / OnlyOffice / Chromium workers before the load starts. The warmup belongs to the pipeline, not to the dataset: a large document reuses the workers already spawned by the small one instead of paying seconds for nothing.

Carbone sometimes resets the connection on the very first render of a kind, while those workers are still spawning. Such failures are retried — a run is skipped only when Carbone never produced a valid document, and the reason is then reported instead of polluting the results.

Each template is uploaded once with `POST /template`, before the measures, so a measured request only carries its JSON dataset. That body is built once by Node and posted verbatim by k6: no base64 encoding, no JSON serialization and no template upload happens inside the load generator — the measured time is Carbone's.

---

## 📊 Methodology

- **Load tool**: [k6](https://k6.io), a fixed number of documents per virtual user (`per-vu-iterations`), so every engine is measured on the same amount of work
- **Endpoint**: `POST /render/:templateVersionId?download=true`, the document is generated *and* downloaded in one call
- **Metrics**: `Doc/min` and the p95 document latency of each profile, `Pages/s` from the one document at a time run, plus median / average / p90 / p99 and failure rate in the CSV
- **Warmup**: 3 renders per pipeline, excluded from the measures, none on documents over 100 pages
- **Out of scale**: a render abandoned after 120s stops its run at once and is reported as `∞` rather than as a duration
- **Response bodies** are discarded by k6 (`discardResponseBodies`) to keep the load generator cheap
- **Thresholds**: `http_req_failed < 1%` and `p(95) < 10s`; a crossed threshold is reported but the measures are kept

The exact environment (host CPU, Docker and k6 versions, image, date) is recorded in `results/index.json` and printed in [RESULT.md](RESULT.md).

> ⚠️ Benchmarks measure a single Carbone container on a single machine. Absolute numbers depend on your hardware. The HTML report compares **converters on the same template**; 1 vs 4 CPU is shown as scaling, not as a ranking. A later phase can add competing products as extra engines in the same per-template table (`vendor` is already on every run).

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
