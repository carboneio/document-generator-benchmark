# 📊 Carbone Document Generator Benchmark

> **How fast does Carbone generate documents?** Real templates, real data, with and without PDF conversion.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Benchmark](https://img.shields.io/badge/benchmark-k6-orange.svg)](https://k6.io)
[![Carbone](https://img.shields.io/badge/carbone-5.14.0-A644C5.svg)](https://carbone.io)

This repository measures the speed of [**Carbone**](https://carbone.io) on real document jobs.

Carbone merges a JSON dataset into a template. It can then convert the result to PDF. Every template of the [`samples/`](samples) folder is measured on **1** conversion factory (`webserver -f 1`), then on **4**. The report calls them **1 CPU** and **4 CPU**.

Each pipeline is measured twice, because two questions matter:

| Measure | How | What it answers |
| ------- | --- | --------------- |
| **One document at a time** | `1 CPU · 1 VU` — one request, no queue | how long one document takes |
| **Under load** | `4 CPU · 5 VU` — five requests at once, one more than the number of CPUs | how many documents per minute |

A **VU** is a *virtual user*. It sends one request, waits for the answer, then sends the next one.

Under load, the latency is mostly queue time. So only the one document at a time run really times a document.

A large dataset adds a **`Pages / s`** figure. It puts a 1 page invoice and a 234 page report on the same scale.

HTML and DOCX are reported apart. Their numbers are not comparable.

Run everything with one command: `npm run bench`. Carbone Enterprise needs a license — [get a free trial with every feature](https://carbone.io/documentation/developer/on-premise-installation/licensing.html#get-a-license).

---

## 🎯 Results

The report is a **dated static HTML page**, one card per template. Each card has a preview of the document and one table:

- **`Documents / min`** at `1 CPU · 1 VU`, then at `4 CPU · 5 VU`. The small figure below is the **p95 latency** of the same run. Under load it includes the queue wait time.
- **`Pages / s`** for one large document, produced alone on one CPU. This is what makes a 1 page invoice comparable with a 234 page report.

The merge has its own row, apart and without a bar: it does not go through the conversion factories. Converters compete on their own template only.

<!-- BENCHMARK:RESULTS:START -->
Latest report: **[2026-08-28 13:29:34 UTC](docs/index.html)** · [previous benchmarks](docs/index.html#history)

| Template sample | Merge only (Documents / min) | Convert to PDF (Documents / min) | Pages / s |
| --- | --- | --- | --- |
| [`financial_chart`](docs/index.html#financial-chart-docx) | DOCX → DOCX **10,717** | **6,870** · DOCX → PDF (fastest: Carbone ICE) | **26** on 1 page (Carbone ICE) |
| [`invoice_simple`](docs/index.html#invoice-simple-docx) | DOCX → DOCX **17,267** | **9,568** · DOCX → PDF (fastest: Carbone ICE) | **154** on 234 pages (Carbone ICE) |
| [`ticket_qrcode`](docs/index.html#ticket-qrcode-docx) | DOCX → DOCX **4,272** | **3,671** · DOCX → PDF (fastest: Carbone ICE) | **160** on 200 pages (Carbone ICE) |
| [`invoice_simple`](docs/index.html#invoice-simple-html) | HTML → HTML **61,652** | **20,851** · HTML → PDF (fastest: Chromium) | **93** on 234 pages (Chromium) |

Throughputs at **4 CPU · 5 VU**. Pages per second on one document alone, at **1 CPU · 1 VU**. The [report page](docs/index.html) also shows the 1 CPU · 1 VU throughput, the p95 latency of every column and a preview of each document.
<!-- BENCHMARK:RESULTS:END -->

Raw k6 metrics of the latest campaign: [RESULT.md](RESULT.md). The HTML pages in [`docs/`](docs) are meant to be committed: a dated snapshot, plus `index.html`.

---

## 🔬 What is measured

Each sample is a **template + JSON data** pair. Carbone always merges the data into the template. The PDF conversion is an extra step, done by a dedicated engine:

| Pipeline | `convertTo` | `converter` | Engine |
| -------- | ----------- | ----------- | ------ |
| Merge only (DOCX → DOCX, HTML → HTML) | – | – | Carbone template engine only |
| DOCX → PDF | `pdf` | `I` | Carbone ICE (Instant Converter Engine, since 5.14.0) |
| Office template → PDF | `pdf` | `L` | LibreOffice |
| Office template → PDF | `pdf` | `O` | OnlyOffice |
| Web template → PDF | `pdf` | `C` | Chromium |

A pipeline is one sample, one dataset, one output format, one converter. Each one is played under two **profiles**. Carbone is started once per profile, never more:

| Profile | Factories (CPU) | Virtual users (VU) | Work | Reported as |
| ------- | --------------- | ------------------ | ---- | ----------- |
| `solo` | 1 | 1 | 10 documents | the `1 CPU · 1 VU` column, and every `Pages / s` |
| `load` | 4 | 5 | 100 documents per user, 60s max | the `4 CPU · 5 VU` column |

Five virtual users on four CPU: one request more than the server can handle at once. Enough to keep every factory busy, not enough to turn the measure into a queue length.

Pipelines come from the samples found in `samples/`, which are auto-discovered, and from the converters that fit their format. DOCX gets LibreOffice, OnlyOffice *and* Carbone ICE. Other office templates get LibreOffice and OnlyOffice. Web templates get Chromium.

Every run stops on a **fixed amount of work**, never on a clock. A slow engine is then measured on the same number of documents as a fast one. `maxDuration` is only a safety net.

A document of more than **100 pages** is measured one at a time, **3 times**, without warmup. A render is abandoned after **120s**, and the report shows `∞` instead of a duration.

With the samples committed here, that is around **35 runs**. Print the plan without running anything:

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

A card is named after what the document is, not after its file. `template_chart.docx` is a financial report, `template_qrcode.docx` an event ticket.

Adding a sample needs **no code change**. Drop `my_template.docx` and `my_template.json` into `samples/`, and they are picked up on the next run. A template without a matching `.json` is rendered with an empty dataset.

### Large documents, and pages per second

A 1 page invoice says nothing about a 200 page report. The merge grows with the data, the conversion grows with the layout. So a template can carry a **second dataset**. Its name ends with the number of pages the document has:

```
template_invoice_simple.docx  +  template_invoice_simple.json        →     1 page
                                 template_invoice_simple_234p.json   →   234 pages
```

Both are measured. The large one feeds the **`Pages / s`** column of the report, the unit that compares a small document with a large one. A large document is only measured one at a time: under load, its duration would say more about the queue than about the document.

Writing a 234 page dataset by hand is no fun, so `bench/grow-sample.mjs` does it. Give it a number of **pages** and the array to grow:

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

It starts with as many entries as pages asked. It renders the PDF with Carbone, counts its pages, then raises the entry count until it passes the target. Two or three renders in practice, since the page count grows almost linearly.

The file is named after the page count obtained, never after the target. The report can then never claim a size the document does not have.

Added entries are copies of the first one, with random content: same shape, same types, same string lengths. Images become mono-color pictures — a solid PNG weighs a few hundred bytes, the original photo 30 KB.

The PDF stays in `.tmp/`, so you can check it. **Carbone must be running**: the page count of a document is only known once it is generated. Pages are counted on the DOCX with Carbone ICE. Use `--template` when several templates share the dataset, `--converter L` for another engine, `--port` for another server.

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

The runner does everything. It starts `carbone/carbone-ee:full-5.14.0` with `-f 1` and plays every sample one document at a time. Then it restarts the container with `-f 4` and plays them again with 5 virtual users. Finally it removes the container and writes the HTML report, `RESULT.md` and the CSV.

The container runs the same command as the [manual one](#-running-carbone-by-hand), only detached and named: `docker run -d --name carbone-bench -p 4000:4000 <image> webserver -s -f <n>`. Extra flags are opt-in (`--env`, `--shm-size`, `--docker-cpus`). The exact command is printed before each start.

### Or start Carbone yourself

To control the container yourself — custom flags, remote server, debugging — start it and point the runner at it with `--no-docker`. One factory count per server, since the runner cannot restart it:

```bash
docker run -t -i --rm -p 4000:4000 carbone/carbone-ee:full-5.14.0 webserver -s -f 4
node bench/run.mjs --no-docker --cpus 4
```

Both modes write to the same `results/` folder. You can run `--cpus 1` and `--cpus 4` in two passes and still get one complete report. Add `--no-solo` to the second pass: timing a single document twice measures the same thing.

Expect roughly **30 minutes** with the default settings: 35 runs, plus warmups and container restarts.

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

Carbone Enterprise needs a license, and so do the PDF converters. [Get a free trial with every feature](https://carbone.io/documentation/developer/on-premise-installation/licensing.html#get-a-license).

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

`CARBONE_LICENSE` and `CARBONE_EE_LICENSE` are forwarded with `docker run -e <name>`, so the key never appears in the printed command. `--license-file` mounts the file read-only in the container `config/` directory. The line `license .......` of the runner header tells you which one was picked up.

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

Like the benchmark does: the template is stored once, then every document is generated from its `templateVersionId`.

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

Before measuring, the runner renders each pipeline until it gets 3 **valid** documents: a PDF must start with `%PDF`, an office document with `PK`. This spawns the LibreOffice, OnlyOffice and Chromium workers before the load starts. The warmup belongs to the pipeline, not to the dataset, so a large document reuses the workers spawned by the small one.

Carbone sometimes resets the connection on the first render of a kind, while those workers are still starting. Such failures are retried. A run is skipped only when Carbone never produced a valid document, and the reason is reported instead of polluting the results.

Each template is uploaded once with `POST /template`, before the measures. A measured request then only carries its JSON dataset. That body is built once by Node and posted as is by k6: no base64 encoding, no JSON serialization, no template upload inside the load generator. The measured time is Carbone's.

---

## 📊 Methodology

- **Load tool**: [k6](https://k6.io), a fixed number of documents per virtual user (`per-vu-iterations`), so every engine gets the same amount of work
- **Endpoint**: `POST /render/:templateVersionId?download=true`, the document is generated *and* downloaded in one call
- **Metrics**: `Documents / min` and the p95 document latency of each profile, `Pages / s` from the one document at a time run, plus median, average, p90, p99 and failure rate in the CSV
- **Warmup**: 3 renders per pipeline, excluded from the measures, none on documents over 100 pages
- **Out of scale**: a render abandoned after 120s stops its run at once, and is reported as `∞` instead of a duration
- **Response bodies** are dropped by k6 (`discardResponseBodies`) to keep the load generator cheap
- **Thresholds**: `http_req_failed < 1%` and `p(95) < 10s`. A crossed threshold is reported, but the measures are kept

The exact environment — host CPU, Docker and k6 versions, image, date — is recorded in `results/index.json` and printed in [RESULT.md](RESULT.md).

> ⚠️ This benchmark measures one Carbone container on one machine. Absolute numbers depend on your hardware. The report compares **converters on the same template**. 1 vs 4 CPU shows scaling, not a ranking. A later phase can add competing products as extra engines in the same table (`vendor` is already on every run).

### Troubleshooting

- **Carbone ICE rows reported as “not available”**: Carbone ICE needs **5.14.0** or later, and only converts DOCX to PDF. Use `--image carbone/carbone-ee:full-5.14.0`, the default.
- **OnlyOffice rows reported as “not available”**: the converter is disabled in the image you used. Point Carbone to the binaries with `CARBONE_ONLY_OFFICE_PATH` (`"x2tPath, AllFontsPath, fontPath"`), or use an image that bundles it.
- **Chromium rows reported as “not available”**: same idea with `CARBONE_CHROME_PATH`.
- **Container exits during startup**: the runner stops at once and prints the container logs. Usually an invalid or expired license, or a port already in use.

---

## 🤝 Contributing

Contributions are welcome: add samples, refine the methodology, improve the report. Feel free to open an issue or a pull request.

## 📄 License

Apache License 2.0 — see [LICENSE](LICENSE).

**Made with ❤️ for the open-source community**
