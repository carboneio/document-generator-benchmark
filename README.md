# 📊 Carbone Document Generator Benchmark

> **How fast does Carbone generate documents?** Real templates, real data, with and without PDF conversion.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Benchmark](https://img.shields.io/badge/benchmark-k6-orange.svg)](https://k6.io)
[![Carbone](https://img.shields.io/badge/carbone-5.15.0-A644C5.svg)](https://carbone.io)

This repository benchmarks the [**Carbone**](https://carbone.io) HTTP API on real document jobs.

Default image: `carbone/carbone-ee:full-5.15.0` (Carbone ICE requires **5.14.0** or later).

> Some samples require **Carbone Enterprise**. [Get a free trial with every feature](https://carbone.io/documentation/developer/on-premise-installation/licensing.html#get-a-license).


## 🎯 Results

> 👉 **Full report: [carboneio.github.io/document-generator-benchmark](https://carboneio.github.io/document-generator-benchmark/)**

- **`Documents / min`** at `1 CPU · 1 VU`, then at `4 CPU · 5 VU` (includes queue wait time)
- **`Pages / s`** for one large document, alone on one CPU
- A **VU** (*virtual user*) sends one request, waits for the answer, then sends the next one

<!-- BENCHMARK:RESULTS:START -->
Latest report: **[2026-09-22 13:51:36 UTC](public/index.html)** · [previous benchmarks](public/index.html#history)

| Template sample | Merge only (Documents / min) | Convert to PDF (Documents / min) | Pages / s |
| --- | --- | --- | --- |
| [`invoice_simple`](public/index.html#invoice-simple-docx) | DOCX → DOCX **17,871** | **13,856** · DOCX → PDF (fastest: Carbone ICE) | **141** on 234 pages (Carbone ICE) |
| [`financial_chart`](public/index.html#financial-chart-docx) | DOCX → DOCX **10,619** | **7,959** · DOCX → PDF (fastest: Carbone ICE) | **26** on 1 page (Carbone ICE) |
| [`ticket_qrcode`](public/index.html#ticket-qrcode-docx) | DOCX → DOCX **6,053** | **5,628** · DOCX → PDF (fastest: Carbone ICE) | **217** on 200 pages (Carbone ICE) |
| [`invoice_simple`](public/index.html#invoice-simple-html) | HTML → HTML **63,102** | **21,804** · HTML → PDF (fastest: Chromium) | **80** on 234 pages (Chromium) |

Throughputs at **4 CPU · 5 VU**. Pages per second on one document alone, at **1 CPU · 1 VU**. The [report page](public/index.html) also shows the 1 CPU · 1 VU throughput, the p95 latency of every column and a preview of each document.
<!-- BENCHMARK:RESULTS:END -->

Raw k6 metrics of the latest campaign: [RESULT.md](RESULT.md).

## 🚀 Getting started

### Prerequisites

- [Docker](https://www.docker.com/get-started) to run Carbone
- [k6](https://k6.io) to generate load
- [Node.js](https://nodejs.org) 18 or later to run the benchmark and build the report

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
export CARBONE_LICENSE=$(cat my_license.carbone-license)
npm run bench
```

The runner starts Carbone with one factory for the `solo` profile, then restarts it with four factories for the `load` profile. It removes the container when done and writes the HTML, Markdown and CSV reports.

The default campaign takes about **30 minutes**. Validate your setup first with the shorter run:

```bash
npm run bench:quick
npm run report       # rebuild reports from existing results
```

The container runs in the background as `carbone-bench`. The exact `docker run` command is printed before each start. Optional Docker settings include `--env`, `--shm-size` and `--docker-cpus`.

### Use an existing Carbone server

For a remote server, custom container or debugging session, start Carbone yourself and pass `--no-docker`:

```bash
docker run -t -i --rm -p 4000:4000 -e CARBONE_LICENSE carbone/carbone-ee:full-5.15.0 webserver -s -f 4
node bench/run.mjs --no-docker --cpus 4
```

The runner cannot restart a server it does not manage, so use one factory count per pass. Results accumulate in `results/`; running `--cpus 1` and `--cpus 4 --no-solo` separately still produces one complete report.

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
| `--image <image>` | `CARBONE_IMAGE` | `carbone/carbone-ee:full-5.15.0` | Carbone Docker image |
| `--port <port>` | `CARBONE_PORT` | `4000` | Host port bound to the container |
| `--container <name>` | `CARBONE_CONTAINER` | `carbone-bench` | Container name |
| `--docker-cpus <n>` | `CARBONE_DOCKER_CPUS` | – | Also cap the container to `n` host CPUs |
| `--license-file <f>` | `CARBONE_LICENSE_FILE` | – | Mount an enterprise license file into the container |
| `--env KEY=VALUE` | – | – | Extra environment variable for the container (repeatable) |
| `--shm-size <size>` | `CARBONE_SHM_SIZE` | – | `/dev/shm` size, e.g. `1g` (useful for Chromium and LibreOffice) |
| `--startup-timeout <s>` | `CARBONE_STARTUP_TIMEOUT` | `120` | How long to wait for Carbone to listen |
| `--request-timeout <s>` | `CARBONE_REQUEST_TIMEOUT` | `60` | Give up on a warmup render after n seconds |
| `--warmup <n>` | `CARBONE_WARMUP` | `3` | Valid renders required before measuring; ignored on documents over 100 pages |
| `--warmup-retries <n>` | `CARBONE_WARMUP_RETRIES` | `3` | Extra warmup attempts allowed on connection reset |
| `--cooldown <sec>` | `CARBONE_COOLDOWN` | `3` | Pause between runs |
| `--results <dir>` | `CARBONE_RESULTS` | `results` | Where JSON results are written |
| `--no-docker` | – | – | Do not manage Docker; use an already running Carbone |
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

Samples that use QR codes or images require a Carbone Enterprise license. [Get a free trial with every feature](https://carbone.io/documentation/developer/on-premise-installation/licensing.html#get-a-license).

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

`CARBONE_LICENSE` and `CARBONE_EE_LICENSE` are forwarded with `docker run -e <name>`, so the key never appears in the printed command. `--license-file` mounts the file read-only in the container `config/` directory. The `license .......` line of the runner header tells you which one was picked up.

## 🧪 Running Carbone by hand

Export `CARBONE_LICENSE` as shown above, then use these commands to check a configuration before running the full benchmark.

### 1. Start Carbone

```bash
# 1 worker
docker run -t -i --rm -p 4000:4000 -e CARBONE_LICENSE carbone/carbone-ee:full-5.15.0 webserver -s -f 1

# 4 workers
docker run -t -i --rm -p 4000:4000 -e CARBONE_LICENSE carbone/carbone-ee:full-5.15.0 webserver -s -f 4
```

### 2. Upload a template

The template is stored once. Every document is then generated from its `templateVersionId`.

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
printf '{"data":%s}\n' "$(cat template_invoice_simple.json)" > payload.json

CARBONE_URL="http://localhost:4000/render/${id}?download=true" \
CARBONE_PAYLOAD=./payload.json CARBONE_VUS=5 CARBONE_RENDERS=100 \
CARBONE_MAX_DURATION=60s CARBONE_TIMEOUT=120s k6 run bench/carbone-bench.js
```

## 📁 How it works

| File | Role |
| ---- | ---- |
| [`bench/matrix.mjs`](bench/matrix.mjs) | Discovers the samples, builds the run matrix, builds the Carbone request body |
| [`bench/carbone-bench.js`](bench/carbone-bench.js) | k6 script measuring **one** configuration, exports a JSON summary |
| [`bench/run.mjs`](bench/run.mjs) | Orchestrator: container lifecycle, template upload, warmup, k6 runs, JSON results |
| [`bench/html.mjs`](bench/html.mjs) | Builds the dated HTML page (one card per template) and the README summary table |
| [`bench/report.mjs`](bench/report.mjs) | Writes `public/<date>.html`, `public/index.html`, `RESULT.md`, CSV and the README summary |
| [`bench/grow-sample.mjs`](bench/grow-sample.mjs) | Standalone: grows a dataset until the document reaches a page count |
| `public/` | Published HTML report, dated snapshots, preview images |
| `results/` | One JSON file per run + `index.json` (all runs and the test environment) |

### Benchmark flow

1. Samples are auto-discovered in `samples/`.
2. After each Carbone start, every template is uploaded once with `POST /template`.
3. Each regular conversion path produces 3 valid warmup documents. Startup connection resets are retried.
4. k6 measures `POST /render/:templateVersionId?download=true`. Requests contain only the JSON dataset, so template upload and payload preparation are excluded.
5. The runner writes the JSON, CSV, Markdown and HTML reports.

Carbone always merges the data into the template. PDF conversion is an optional extra step:

| Pipeline | `convertTo` | `converter` | Engine |
| -------- | ----------- | ----------- | ------ |
| Merge only (DOCX → DOCX, HTML → HTML) | – | – | Carbone template engine only |
| DOCX → PDF | `pdf` | `I` | Carbone ICE (Instant Converter Engine, since 5.14.0) |
| Office template → PDF | `pdf` | `L` | LibreOffice |
| Office template → PDF | `pdf` | `O` | OnlyOffice |
| Web template → PDF | `pdf` | `C` | Chromium |

A **pipeline** is one template, one dataset, one output format and one converter. It runs under two profiles:

| Profile | Factories (CPU) | Virtual users (VU) | Work | Reported as |
| ------- | --------------- | ------------------ | ---- | ----------- |
| `solo` | 1 | 1 | 10 documents | the `1 CPU · 1 VU` column, and every `Pages / s` |
| `load` | 4 | 5 | 100 documents per user, 60s max | the `4 CPU · 5 VU` column |

Five VUs keep four factories busy with at most one queued request. Runs stop after a **fixed amount of work**, so every engine processes the same number of documents. `maxDuration` is only a safety net.

```bash
npm run plan # print the complete matrix without running it
```

### Samples

| Template | Data | Card on the report | Formats benchmarked |
| -------- | ---- | ------------------ | ------------------- |
| `template_invoice_simple.docx` | `template_invoice_simple.json` + `_234p.json` | `invoice_simple` DOCX | merge only, PDF (LibreOffice, OnlyOffice, Carbone ICE) |
| `template_invoice_simple.html` | the same two datasets | `invoice_simple` HTML | merge only, PDF (Chromium) |
| `template_chart.docx` | `template_chart.json` | `financial_chart` | merge only, PDF (LibreOffice, OnlyOffice, Carbone ICE) |
| `template_qrcode.docx` | `template_qrcode.json` | `ticket_qrcode` | merge only, PDF (LibreOffice, OnlyOffice, Carbone ICE) |

Adding a sample needs **no code change**: drop `my_template.docx` and `my_template.json` into `samples/`. A template without matching JSON is rendered with an empty dataset.

### Large documents and pages per second

A template can use a second dataset whose name contains the resulting page count:

```
template_invoice_simple.docx  +  template_invoice_simple.json        →     1 page
                                 template_invoice_simple_234p.json   →   234 pages
```

Documents over **100 pages** are measured one at a time, 3 times, without warmup. They feed the **`Pages / s`** column. Generate a large dataset with:

```bash
node bench/grow-sample.mjs samples/template_invoice_simple.json 200 d.products
node bench/grow-sample.mjs samples/template_qrcode.json 200 d
```

Carbone must be running. The script grows the chosen array, randomizes copied values, replaces images with lightweight mono-color versions, renders with Carbone ICE and names the JSON after the measured page count. The generated PDF remains in `.tmp/`.

### Measurement rules

- **Metrics:** documents/min, p95 latency and pages/s. The CSV also contains median, average, p90, p99 and failure rate.
- **Timeout:** a render abandoned after 120s stops the run and is reported as `∞`.
- **Thresholds:** `http_req_failed < 1%` and `p(95) < 10s`. Results are kept if a threshold is crossed.
- **Efficiency:** k6 drops response bodies during measured runs to keep the load generator cheap.

The exact environment (host CPU, Docker and k6 versions, image, date) is recorded in `results/index.json` and printed in [RESULT.md](RESULT.md).

> ⚠️ This benchmark measures one Carbone container on one machine. Absolute numbers depend on the hardware. The report compares **converters on the same template**. Comparing 1 and 4 CPUs shows scaling, not a product ranking.

## 🛠️ Troubleshooting

- **Carbone ICE rows reported as “not available”**: Carbone ICE needs **5.14.0+** (DOCX → PDF only). Default image is `carbone/carbone-ee:full-5.15.0`.
- **OnlyOffice rows reported as “not available”**: the converter is disabled in the selected image. Set `CARBONE_ONLY_OFFICE_PATH` (`"x2tPath, AllFontsPath, fontPath"`) or use an image that bundles it.
- **Chromium rows reported as “not available”**: set `CARBONE_CHROME_PATH` or use an image that bundles Chromium.
- **Container exits during startup**: the runner prints the container logs. Common causes are an invalid license or a port already in use.

## 🤝 Contributing

Contributions are welcome. Add samples, refine the methodology or improve the report through an issue or pull request.

## 📄 License

Apache License 2.0. See [LICENSE](LICENSE).

**Made with ❤️ for the open-source community**
