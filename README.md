# Browser Startup Lab

Compare lightweight browsers for AI agents and reproduce **process cold-start latency below 1.5 seconds**, using browser binaries and profiles isolated from your everyday Chrome.

The lab benchmarks Chrome for Testing, Chrome Headless Shell, and Lightpanda directly through Puppeteer/CDP and through [Vercel agent-browser](https://github.com/vercel-labs/agent-browser). It includes installers, a local test page, raw measurements, screenshots, and a cross-platform GitHub Actions workflow.

**Recommendation:** Headless Shell + agent-browser for fast general automation; full Chrome for Testing as a compatibility fallback. Lightpanda is fast for DOM extraction, but normal agent-browser clicks failed in the tested versions.

## Benchmark scores

Measured on Apple M1, 8 cores, 16 GB RAM, macOS 26.5.1. All times include a new browser process; they are not measurements of an already-running browser.

### Verified process cold starts

The portable harness was validated on 2026-11-27 Asia/Shanghai (2026-11-26 UTC). Each CLI trial used a **unique daemon/session**, and every browser was closed before the next trial. Direct Chrome trials use freshly created profile directories.

| Headless Shell path | Trials | Median | p95 / maximum | Under 1.5 s |
| --- | ---: | ---: | ---: | ---: |
| Direct process → CDP → local page → successful JavaScript | 10 | **196 ms** | **699 ms** | **10/10** |
| New agent-browser daemon + browser → local page → interactive snapshot | 10 | **351 ms** | **440 ms** | **10/10** |

Raw evidence: [cold-start trials, process IDs, unique sessions, cleanup results, and machine metadata](results/validation/macos-arm64-shell-cold.json). With only ten samples, nearest-rank p95 equals the maximum; this is an observed score, not an SLA.

A three-trial full-Chrome validation measured **909 ms median / 2,786 ms maximum (2/3 below 1.5 s)**, so full Chrome does not consistently meet the target in every later run. [Raw Chrome validation](results/validation/macos-arm64-chrome-cold.json). Lightpanda revalidation measured **256 ms median / 267 ms maximum** for CLI startup but reproduced the click failure. [Raw Lightpanda validation](results/validation/macos-arm64-lightpanda-cold.json). An earlier portable Shell run measured 328 / 383 ms; it is [preserved separately](results/validation/macos-arm64-shell-cold-initial.json).

### Original comparison

These ten-trial results were measured on 2026-11-26 on the same machine. The direct rows exclude the separately retained first-ever execution observations.

| Engine | Direct cold start median / max | agent-browser cold start median / max | Compatibility observed |
| --- | ---: | ---: | --- |
| Full Chrome, tuned | 486 / 671 ms | 628 / 1,104 ms | Snapshot, fill, click, styled screenshot passed |
| Headless Shell | 160 / 425 ms | 308 / 313 ms | Snapshot, fill, click, CSS and canvas passed |
| Lightpanda | 33 / 135 ms | 256 / 329 ms | DOM/JS and snapshots passed; normal CLI click failed |

Sources: [direct trials](results/direct.json), [full Chrome CLI](results/cli-chrome-tuned-no-version-check.json), [Shell CLI](results/cli.json), [Lightpanda CLI](results/cli-lightpanda-no-version-check.json). An additional wrapper test, including Node startup and browser discovery, measured Shell at 408 ms median / 472 ms max over five `about:blank` trials: [raw results](results/wrapper.json).

**The CLI scores above use `--fast`.** This disables agent-browser's synchronous online outdated-Chrome/CVE advisory lookup for that daemon. With the advisory enabled, original CLI medians were **3,921 ms for full Chrome** and **3,354 ms for Shell**. The advisory [fetch has a three-second timeout](https://github.com/vercel-labs/agent-browser/blob/v0.45.0/cli/src/browser_security.rs), which was the main local startup bottleneck. `--fast` does not disable the browser sandbox or TLS checks. Close a session before changing the flag. These browser downloads do not auto-update; check releases and update deliberately. Direct Puppeteer startup does not require this opt-out.

### What “cold start” means here

- **Process cold:** no reused browser process or CLI daemon. This is measured on every trial. Readiness includes local navigation and JS execution (direct) or an interactive snapshot (CLI). It is stronger than merely observing an open debugging port.
- **First-ever binary launch:** original full Chrome took **4,878 ms** and Shell **6,116 ms**. These costs are preserved in [the original first-run dataset](results/all.json). Their cause was not isolated.
- **Reboot/disk-cache cold:** not established by these local measurements. The harness does not reboot the OS or purge filesystem caches. Starting a new process does not imply a cold OS page cache.
- **Warm operations:** separately reported as `warm_snapshot_ms`; never included as cold-start scores.

Internet page loading, login, complex website readiness, memory usage, and broad website compatibility are outside this benchmark. The local fixture removes external network variance, except when the optional online advisory is enabled.

## Reproduce on another OS

Requires **Node.js 22.12+** and npm. Commands below work in macOS/Linux shells and Windows PowerShell without Unix environment-variable syntax.

```sh
git clone https://github.com/wolvever/browser-startup-lab.git
cd browser-startup-lab
npm ci
npm run setup

# Full direct-engine and CLI comparison; missing Lightpanda is recorded as skipped.
node benchmark.mjs --mode all --rounds 10 --fast

# Recommended option only, with fresh process/session per trial.
node benchmark.mjs --mode all --engine shell --rounds 10 --fast

# Measure the stock advisory-enabled CLI too.
node benchmark.mjs --mode cli --engine shell --rounds 10
```

`npm run setup` downloads **pinned Chrome for Testing and Headless Shell 158.0.8127.88** for the detected host. It does not launch those browsers. Binaries stay in `browsers/`; no regular Chrome installation or profile is selected. Node dependencies and native agent-browser packages are pinned in `package-lock.json`.

| OS | Chrome / Shell | Lightpanda |
| --- | --- | --- |
| macOS | Apple Silicon and Intel, as supported by pinned upstream binaries | Apple Silicon and Intel |
| Linux | Official Chrome for Testing Linux x64 builds; glibc/system libraries required | glibc x64 and arm64 |
| Windows | Official Chrome for Testing Windows builds; native agent-browser selection | Run the entire lab in WSL2; no native Lightpanda binary |

The installer reports an error if the pinned upstream Chrome build is unavailable for the detected architecture. In particular, do not assume native Linux ARM64 Chrome for Testing support. Local validation used macOS ARM64. The supplied workflow has also passed on Linux x64, macOS ARM64, and Windows x64 for Headless Shell; see the runner scores below.

On minimal Debian/Ubuntu hosts, install browser system libraries using the installer with root privileges (uses upstream dependency metadata):

```sh
sudo node setup.mjs --with-deps
```

On Linux systems restricting unprivileged user namespaces, configure an appropriate Chromium sandbox policy. The lab does not automatically add `--no-sandbox`.

### Add Lightpanda

```sh
npm run setup -- --lightpanda
# For a Lightpanda-only host, without downloading Chrome:
node setup.mjs --lightpanda-only
node benchmark.mjs --mode all --engine lightpanda --rounds 10 --fast
```

The nightly download URL is mutable. Setup records the actual Lightpanda version, download URL, and SHA-256 in ignored `installation.json`; each benchmark embeds that metadata. The historical tested build is **1.1.0-nightly.12455+06b13205b**, SHA-256 `48724345e00c3a02bdde370d60ce5933d93888d13aedaca8eb6406fe35f1d60d`. A newer nightly is a new experiment, not an exact reproduction. The installer invokes Lightpanda's `version` command, so it does not preserve first-ever executable launch for Lightpanda.

Lightpanda's normal agent-browser click failed with `DOM.getNodeForLocation wasn't found`. Its screenshot is text rendering, without the fixture's CSS colors or canvas; see [the screenshot](results/cli-lightpanda.png) and [upstream rendering documentation](https://lightpanda.io/docs/reference/python). Direct programmatic DOM submission passed; that does not establish native pointer-click compatibility. Persistent profiles and storage state also have [adapter limitations](https://agent-browser.dev/engines/lightpanda).

### Measure first-use startup on a new host

After installing binaries on a fresh host, run this **before any other browser command**:

```sh
node benchmark.mjs --mode direct --engine shell --rounds 1 --label first-use
```

The harness performs no browser warmup and retains the first trial. The label is an operator annotation, not proof that the OS cache was cold. For a reboot experiment, reboot manually and run the chosen single-trial command first, using `--label after-reboot`; record the conditions alongside its output. Repeat one reboot per sample if you want a distribution of reboot-cold results.

### Results and methodology

Every run writes to its own `results/runs/<timestamp>-<pid>-<label>/` directory:

- `results.json`: machine/OS/Node and package versions, setup metadata, exact options, methodology, individual samples, summaries, and failures.
- CLI snapshots and screenshots from the first trial of each engine.
- Direct samples include browser PIDs; CLI samples include unique session IDs and close results.

The timer starts before browser/daemon launch and ends after the readiness check. Profile creation and CDP setup are included in direct timing. Process shutdown is outside the timed interval and happens before the next trial. Trials run sequentially. No samples are discarded as warmups. Compatibility failures are recorded separately from startup latency. Startup/cleanup errors produce a nonzero exit; known Lightpanda form incompatibility is recorded as `form: false`.

Options: `--mode all|direct|cli`, `--engine all|chrome|chrome-tuned|shell|lightpanda`, `--rounds N`, `--fast`, and `--label LABEL`. `chrome` CLI uses stock agent-browser launch arguments; `chrome-tuned` additionally disables extensions and starts at `about:blank`. Direct `chrome` includes both baseline and tuned variants. Most direct tuning flags already overlap Puppeteer's defaults, so the flag-only change is modest.

Original measurements under `results/` remain versioned. New `results/runs/` outputs are ignored to avoid overwriting or automatically committing machine-specific runs; copy a selected run into `results/validation/` to publish it.

## Use the isolated agent browser

```sh
node agent.mjs --fast shell open https://example.com
node agent.mjs --fast shell snapshot -i
# Use refs from the returned snapshot for fill/click.
node agent.mjs --fast shell close
```

Replace `shell` with `chrome` or `lightpanda`. Omit `--fast` to retain the online advisory check. The launcher detects the installed native agent-browser binary for the OS/architecture, including Windows. It does not depend on global executables or Unix `.bin` shims. Pass `--session NAME` after the engine to override the default session when multiple agents share the lab.

The launcher uses the explicit empty config and dedicated `startup-lab-use` namespace; benchmarks use `startup-lab` with unique sessions. agent-browser stores its own metadata under its namespaced state directory. Chrome for Testing may create its own separate crash-report directory. Daily Chrome cookies, profiles, settings, and global browser defaults are not imported or changed.

## Run the OS matrix on GitHub

In **Actions → Cross-platform browser benchmark → Run workflow**, launch the manual workflow. It installs the pinned dependencies and browser, then measures ten direct and ten CLI Headless Shell cold starts on **Ubuntu 22.04, macOS, and Windows**. No browser warmup is performed; the first trial retains first-use costs. JSON and screenshots are uploaded as per-OS artifacts even if a job fails. Hosted-runner scores are not directly comparable to the M1 laptop scores. The workflow is manual so pushing commits does not silently start benchmark jobs.

### Verified GitHub runner scores

[Workflow run 45855919068](https://github.com/wolvever/browser-startup-lab/actions/runs/45855919068) passed all three jobs. Each path below has ten process-cold trials, no discarded warmup, and the CLI advisory disabled. Form interaction and cleanup passed on every OS. Passing CI establishes that the experiment runs; it does not enforce a 1.5-second threshold.

| Runner | Direct median / max | CLI median / max | CLI below 1.5 s |
| --- | ---: | ---: | ---: |
| Ubuntu 22.04 x64 | 229 / 457 ms | 313 / 1,882 ms | 9/10 |
| macOS ARM64, virtual M2 Pro | 150 / 262 ms | 339 / 388 ms | 10/10 |
| Windows x64 | 408 / 1,500 ms | 1,116 / 1,171 ms | 10/10 |

All values are rounded to milliseconds; the Windows direct path had 9/10 samples strictly below 1,500 ms. [Committed raw runner results and screenshots](results/validation/github-run-45855919068) retain the complete distributions and first trials. The Linux CLI outlier and Windows direct first-use cost remain included.

## Files and research

- `setup.mjs`: host-specific browser downloads and version/hash recording.
- `runtime.mjs`: pinned browser selection and agent-browser native binary discovery.
- `benchmark.mjs`: fixture, cold-start measurement, compatibility checks, and raw output.
- `agent.mjs`: isolated interactive CLI wrapper.
- `results/`: original evidence and selected portable-harness validations.
- [Original research report](docs/original-report.md): detailed first-session findings and alternative-engine research.

Headless Shell is a separate Chromium implementation and does not offer every full Chrome feature; see [Puppeteer's headless-mode guidance](https://pptr.dev/guides/headless-modes). [Chrome for Testing](https://developer.chrome.com/docs/automation-and-testing/chrome-for-testing) provides the full-browser fallback. Obscura was researched but not benchmarked; its [experimental adapter documents fidelity gaps](https://agent-browser.dev/engines/obscura).

Dependencies, downloaded executables, profiles, and generated installation metadata are excluded from Git. Install scripts and lockfiles provide everything needed to repeat the experiment without committing platform-specific browser binaries.
