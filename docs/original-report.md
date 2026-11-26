> Historical report from the original macOS experiment. For current cross-platform commands and methodology, use [the repository README](../README.md).

# Isolated browser startup lab

Tested on Apple M1 (8 cores, 16 GB), macOS 26.5.1, 2026-11-26.

Recommendation: use **Chrome Headless Shell with Vercel agent-browser** for a fast agent browser with actual rendering. Keep **Chrome for Testing** as the full Chrome fallback. Both meet the 1.5-second process-start target here. Lightpanda is substantially faster directly, but the tested combination cannot perform normal agent-browser clicks.

## Run the installed setup

```sh
cd /Users/jucheng/work/browser-startup-lab
node agent.mjs --fast shell open https://example.com
node agent.mjs --fast shell snapshot -i
# Use refs from that snapshot for subsequent click/fill commands.
node agent.mjs --fast shell close
```

Replace `shell` with `chrome` for full Chrome or `lightpanda` for experiments. The wrapper targets this Apple Silicon Mac. Use `--session NAME` after the engine to override its default session when multiple agents share the lab.

**`--fast` disables agent-browser's online outdated-Chrome/CVE advisory lookup for that launched daemon** (`AGENT_BROWSER_NO_VERSION_CHECK=1`). It preserves the browser sandbox and TLS validation. Without `--fast`, the advisory remains enabled, but it added about three seconds per cold CLI launch on this network. Close the session before changing this setting. These downloaded browser versions do not auto-update: refresh them deliberately and check current releases. For a custom Puppeteer integration, the direct launch path already meets the target without this agent-browser setting.

The wrapper uses explicit binaries under `browsers/` or `bin/`, an empty explicit config, temporary browser profiles, and dedicated `startup-lab-use` daemon namespaces. It does not select your daily Chrome, import its cookies, change its settings, or set global defaults. agent-browser stores its own daemon metadata in `~/.agent-browser/namespaces/startup-lab-use`; benchmarks use `startup-lab`. Chrome for Testing can create its own separate crash-report directory under macOS Application Support.

## Measured results

Direct measurements include starting the process, connecting over CDP, creating a page, loading a localhost fixture, and successfully evaluating JavaScript. Ten launches per row, fresh profiles for Chrome, with the previous browser closed before the next trial. Values below are from the repeat run after each downloaded executable had been launched once.

| Direct engine path | Median | Maximum | Below 1.5 s |
| --- | ---: | ---: | ---: |
| Chrome for Testing, Puppeteer defaults | 539 ms | 715 ms | 10/10 |
| Chrome for Testing, extra startup flags | 486 ms | 671 ms | 10/10 |
| Chrome Headless Shell | 160 ms | 425 ms | 10/10 |
| Lightpanda CDP | 33 ms | 135 ms | 10/10 |

CLI measurements include a new daemon/browser, loading the same local fixture, and a separate `snapshot -i` command. The fixture includes JavaScript, an input, a button, CSS, and canvas. Form interaction is checked on the first trial, after the timed snapshot.

| agent-browser path | Median | Maximum | Below 1.5 s |
| --- | ---: | ---: | ---: |
| Full Chrome, stock advisory enabled | 3,921 ms | 4,389 ms | 0/10 |
| Headless Shell, stock advisory enabled | 3,354 ms | 3,681 ms | 0/10 |
| Full Chrome, fewer startup features, advisory enabled | 3,664 ms | 3,717 ms | 0/10 |
| Full Chrome, fewer startup features, advisory disabled | 628 ms | 1,104 ms | 10/10 |
| Headless Shell, advisory disabled | 308 ms | 313 ms | 10/10 |
| Lightpanda, advisory disabled | 256 ms | 329 ms | 10/10, but click fails |

The delivered `agent.mjs --fast` wrapper was also tested end to end, including its Node startup and installed-browser discovery, against `about:blank`: Shell median **408 ms**, max **472 ms**; full Chrome median **738 ms**, max **947 ms** (five trials each). A public `example.com` navigation and snapshot also succeeded through the Shell wrapper; internet latency is outside the startup target.

**First-ever execution is different.** The initial downloaded full Chrome launch took 4,878 ms and initial Shell launch 6,116 ms. Those observations remain in `results/all.json`. Their cause was not isolated; macOS executable verification and filesystem caching may contribute. The results do not establish a sub-1.5-second guarantee after a reboot, with cold disk caches, under load, or on arbitrary websites. No cache purge or laptop reboot was performed. Ten-run maxima are observations, not a latency guarantee.

## What worked and what failed

- **Headless Shell:** agent-browser snapshots, ref-based fill/click, successful form result, CSS colors, and canvas screenshot all passed. The screenshot was visually inspected. Shell is a separately distributed Chromium headless implementation; it does not provide every regular Chrome feature. See [Puppeteer's headless modes guide](https://pptr.dev/guides/headless-modes).
- **Chrome for Testing:** the same checks passed. The wrapper disables extensions and starts with `about:blank` to avoid unnecessary startup work. This is the fallback when Shell differs from full Chrome; extension-dependent tasks require a different launch configuration. Google provides [versioned automation binaries without automatic updates](https://developer.chrome.com/docs/automation-and-testing/chrome-for-testing).
- **Lightpanda:** direct CDP navigation, JavaScript, DOM extraction, and programmatic DOM form submission passed. agent-browser snapshot and fill worked. Normal `click @e3` failed with `DOM.getNodeForLocation wasn't found`, because agent-browser could not perform its hit test. A PNG was generated but visual inspection showed text without the fixture's colors or canvas. Lightpanda documents its [text-only screenshot rendering](https://lightpanda.io/docs/reference/python). Treat it as an extraction/DOM engine and validate target websites. The [agent-browser adapter guide](https://agent-browser.dev/engines/lightpanda) also lists unsupported persistent-profile and storage-state flags.
- **agent-browser:** a controller/CLI, not a separate browser engine. It can use Chrome or Lightpanda and keeps a daemon alive between commands. Warm snapshots measured about 6–10 ms. Its v0.45.0 [advisory HTTP fetch has a three-second timeout](https://github.com/vercel-labs/agent-browser/blob/v0.45.0/cli/src/browser_security.rs); the [first command awaits it](https://github.com/vercel-labs/agent-browser/blob/v0.45.0/cli/src/native/actions.rs). The measured three-second drop with the documented opt-out strongly identifies this as the local bottleneck. A future upstream improvement could cache or asynchronously run this advisory while preserving warnings; this lab does not patch the upstream binary.
- **Obscura:** researched, not installed or benchmarked. It is another lightweight CDP/V8 engine, but its [experimental adapter documents accessibility, iframe, hidden-element and screenshot fidelity gaps](https://agent-browser.dev/engines/obscura). It is not the recommended fallback for this compatibility requirement.

No broad real-site compatibility or memory benchmark was performed. Advertised Lightpanda speed/memory ratios are not substituted for measurements here.

## Reproduce

Installed versions: agent-browser **0.45.0**, Puppeteer Core **25.19.0**, browser installer **3.3.0**, Chrome and Shell **158.0.8127.88**, Lightpanda **1.1.0-nightly.12455+06b13205b**. Dependencies are pinned in `package-lock.json`; Lightpanda's SHA-256 and machine details are in `results/manifest.json`.

```sh
npm ci
node_modules/.bin/browsers install chrome@158.0.8127.88 --path ./browsers
node_modules/.bin/browsers install chrome-headless-shell@158.0.8127.88 --path ./browsers
# Lightpanda nightly URL is mutable; verify version and SHA against manifest for exact reproduction.
curl -fL -o bin/lightpanda https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-aarch64-macos
chmod +x bin/lightpanda

DIRECT_ONLY=1 node benchmark.mjs
CLI_ONLY=1 node benchmark.mjs
AGENT_BROWSER_NO_VERSION_CHECK=1 CLI_ONLY=1 ENGINE=shell node benchmark.mjs
AGENT_BROWSER_NO_VERSION_CHECK=1 CLI_ONLY=1 ENGINE=chrome-tuned node benchmark.mjs
AGENT_BROWSER_NO_VERSION_CHECK=1 CLI_ONLY=1 ENGINE=lightpanda node benchmark.mjs
```

Run benchmarks sequentially to avoid introducing competing browser startup work. `ROUNDS` defaults to 10. Direct extra flags only add background/component update suppression and first-run/default-browser/sync suppression to Puppeteer's defaults; much of this is already default, so the flag-only improvement is modest and not isolated statistically. CLI full-Chrome tuning additionally disables extensions and sets `about:blank`. The substantial improvements come from Shell and removing the synchronous advisory from the critical path.

Raw original trials: `results/all.json`; repeat direct trials: `results/direct.json`; fast Shell: `results/cli.json`; fast Chrome: `results/cli-chrome-tuned-no-version-check.json`; fast Lightpanda: `results/cli-lightpanda-no-version-check.json`. Logs and screenshot artifacts are alongside these files. Rerunning writes new results, so copy existing results first if preserving the original experiment.
