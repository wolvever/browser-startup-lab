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

Internet page loading, login, complex website readiness, and broad website compatibility are outside this benchmark. The original macOS runs did not measure memory. The Linux comparison below does. The local fixture removes external network variance, except when the optional online advisory is enabled.

## Linux x64: agent-browser vs Lightpanda

Measured on 2026-11-27 00:23 Asia/Shanghai (2026-11-26 16:23 UTC) on Linux x64, 4 cores, 15.6 GB, Node 22.23.4. Ten process-cold trials each, advisory disabled, no discarded warmup. agent-browser here means the CLI driving Headless Shell. Lightpanda is judged on that same CLI, which is how an agent drives it. Direct CDP numbers are context for the engine itself.

Memory is the proportional set size (PSS) of processes that appeared during the trial, sampled after ready. RSS is higher for Chrome because its processes share libraries.

| Path | Cold median / max | Warm snapshot median | PSS / RSS | Agent click | Screenshot fidelity |
| --- | ---: | ---: | ---: | ---: | ---: |
| agent-browser + Headless Shell | **203 / 210 ms** | 4.6 ms | 188 / 446 MiB | **10/10** | **10/10** |
| agent-browser + Lightpanda | 221 / 228 ms | **3.5 ms** | **35 / 39 MiB** | 0/10 | 0/10 |
| Direct Headless Shell | 82 / 99 ms | 0.7 ms | 180 / 504 MiB | DOM only | 10/10 |
| Direct Lightpanda | **26 / 30 ms** | **0.3 ms** | **21 / 23 MiB** | DOM only | 0/10 |

The agent click is `snapshot -i`, then `fill @ref` and `click @ref`. Lightpanda refused every click with `DOM.getNodeForLocation wasn't found`. Its screenshot is black text on white, without the fixture's navy page, red canvas border, or black canvas fill. Direct DOM `.click()` does submit the form, and that path is not the agent's hit test.

**agent-browser won.** A path that cannot click or render the fixture does not win the agent benchmark, even though Lightpanda uses less memory and is much faster over direct CDP. Through the CLI, Lightpanda's cold start was also slower than Shell (221 vs 203 ms). Raw evidence, including both screenshots: [linux-x64-agent-vs-lightpanda](results/validation/linux-x64-agent-vs-lightpanda).

### Five optimization loops

The workload is five iterations of open, snapshot, ref fill, ref click, read, and screenshot. Each candidate ran twice. A change was kept only when every loop still passed the click and the screenshot check, and the median total dropped at least 5% (or memory dropped 10%, or the first loop dropped 8%, without the total slowing more than 3%).

| Loop | Change | Median total | Decision |
| --- | --- | ---: | --- |
| 0 | Cold daemon every loop | 1,760 ms | baseline |
| 1 | Reuse one daemon for all five loops | **816 ms** | **kept, −54%** |
| 2 | Batch fill, click, read, and screenshot after the snapshot | 766 ms | not stable (6.1% here, 1.3% on the previous hillclimb) |
| 3 | `--no-webmcp` | 784 ms | dropped |
| 4 | Extra Chromium launch flags, including `--disable-gpu` | 799 ms | dropped, slightly slower and larger |
| 5 | Compact interactive snapshot | 783 ms | dropped |

Leave the session open between agent commands. Closing it throws away the only change that reliably cut the five-loop time in half. Batching the tail is optional and was inside run-to-run noise, so the launcher still issues separate commands.

The documented `node agent.mjs --fast shell` wrapper was then measured on the same five reused loops. It paid for an `@puppeteer/browsers` import on every command, about 30 ms, before it found a path that is determined by the pinned version. Resolving that path in `runtime.mjs` without the import cut wrapper startup from about 50 ms to about 26 ms, and the five loops from **2,131 ms to 1,385 ms**, with all five clicks and screenshots still passing. [`wrapper-after.json`](results/validation/linux-x64-agent-vs-lightpanda/wrapper-after.json).

```sh
node compare.mjs --rounds 10
node optimize.mjs
```

## Long residency application

`fixture/residency-application.html` is a 13-section form, about 10,300 pixels tall, with 121 answers: text, email, phone, URL, dates, months, numbers, a range, text areas, selects, a multi-select, radios, and checkboxes. Repeated labels such as City, Country, and Employer are disambiguated by section. Two boxes must stay empty, one starts checked, and a disabled staff field plus a read-only application id must keep their original values. `node fill-form.mjs` drives each engine the way an agent does: a scoped snapshot, then `fill`, `select`, or `check` on the ref. Date and month controls are the exception. Chrome exposes them as repeated Month, Day, and Year spin buttons, and filling one part is rejected, so those controls are set with `fill #id`.

| Engine | Answers correct | Actions that failed | Submitted |
| --- | ---: | ---: | ---: |
| agent-browser + Headless Shell | **121/121** | **0** | **yes** |
| agent-browser + Lightpanda | 101/121 | 20 | no |

Shell stored the application. The receipt shows Amelia Okonkwo, `dob=1991-04-17`, `citizenship=Canada`, `job1-current=yes`, `areas=Marine ecology|Genomics|Climate`, and the certification boxes. The read-only id stayed `APP-2026-00421`, the disabled field stayed `INTERNAL`, and the marketing and "on behalf of someone else" boxes stayed empty.

Lightpanda filled every text field, date, number, range, and select, including the multi-select. All 20 failures are radios and checkboxes. `check` is refused with `DOM.getNodeForLocation wasn't found`, and the same error blocks Submit. Those 20 answers stayed blank, so the application was not stored. Evidence: [linux-x64-long-form](results/validation/linux-x64-long-form).

```sh
node fill-form.mjs
```

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
# Leave this session open across repeated commands. Closing it between
# five local task loops cost about 940 ms on the Linux run above.
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
- `compare.mjs`: cold start, warm snapshot, memory, ref click, and screenshot fidelity for agent-browser and Lightpanda.
- `optimize.mjs`: five-loop hillclimb on the agent-browser path.
- `metrics.mjs`: shared summaries, process memory, and PNG fidelity check.
- `fill-form.mjs`: fills the long residency application through agent-browser and Lightpanda.
- `fixture/residency-application.html`: the 13-section form.
- `agent.mjs`: isolated interactive CLI wrapper.
- `results/`: original evidence and selected portable-harness validations.
- [Benchmark prompt](docs/benchmark-prompt.md): agent instructions for the contest, the five-loop hillclimb, and the long-form fill.
- [Original research report](docs/original-report.md): detailed first-session findings and alternative-engine research.

Headless Shell is a separate Chromium implementation and does not offer every full Chrome feature; see [Puppeteer's headless-mode guidance](https://pptr.dev/guides/headless-modes). [Chrome for Testing](https://developer.chrome.com/docs/automation-and-testing/chrome-for-testing) provides the full-browser fallback. Obscura was researched but not benchmarked; its [experimental adapter documents fidelity gaps](https://agent-browser.dev/engines/obscura).

Dependencies, downloaded executables, profiles, and generated installation metadata are excluded from Git. Install scripts and lockfiles provide everything needed to repeat the experiment without committing platform-specific browser binaries.
