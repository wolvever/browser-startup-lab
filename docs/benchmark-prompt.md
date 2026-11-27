# Benchmark prompt

Give this file to an agent as the whole task. Run it in this repository. Report every clock time in Asia/Shanghai and name that zone. Publish evidence under `results/validation/`. Leave `results/runs/` uncommitted.

## Goal

Compare **agent-browser driving Chrome Headless Shell** with **Lightpanda driven by the same agent-browser CLI**. Measure process cold start, warm snapshot, memory, agent use, and screenshot fidelity. If agent-browser wins that contest, optimize a five-loop agent workload and keep only changes that still pass the functional checks. Then fill `fixture/residency-application.html` through agent commands and score every answer, including fields that must stay untouched.

agent-browser is the CLI, not a browser engine. Lightpanda's direct CDP numbers are context. The agent interface is `snapshot -i`, then `fill`, `select`, `check`, or `click` on a snapshot ref.

## Setup

Requires Node.js 22.12 or newer.

```sh
npm ci
sudo "$(command -v node)" setup.mjs --lightpanda --with-deps
```

`sudo node` fails when Node is not on root's `PATH`. The pinned browsers are Chrome for Testing and Headless Shell **158.0.8127.88** under `browsers/`, and Lightpanda under `bin/lightpanda`. Record the Lightpanda version and SHA-256 from `installation.json`. A newer Lightpanda nightly is a new experiment.

Disable the agent-browser CVE advisory for every timed CLI trial (`--fast`, which sets `AGENT_BROWSER_NO_VERSION_CHECK=1`). The advisory fetch has a three-second timeout and is the local startup bottleneck. It does not disable the browser sandbox or TLS checks. Close a session before changing the flag.

Use the empty config `empty-config.json`. Benchmarks use the `startup-lab` namespace. The comparison harness uses `startup-lab` sessions prefixed per run. The optimizer uses `startup-lab-opt`. The form driver uses `startup-lab-form`. Give every process-cold trial its own session, and close that session before the next trial.

## Contest

```sh
node compare.mjs --rounds 10
```

Ten process-cold trials, no discarded warmup, trials in sequence. Paths: `cli-shell`, `cli-lightpanda`, `direct-shell`, `direct-lightpanda`.

| Measure | Definition |
| --- | --- |
| Cold start | New browser process. CLI also starts a new daemon and session. Timer ends after local navigation plus an interactive snapshot (CLI) or JavaScript ready (direct). |
| Warm snapshot | Median of five extra interactive snapshots on that same process. |
| Memory | Sum of RSS and, when `/proc` exposes it, proportional set size of processes that appeared during the trial. Sample after ready, before the action. Report PSS and RSS. |
| Agent use | CLI: `snapshot -i`, `fill @ref`, `click @ref`, then read the result text. Direct: set the field and click through the DOM. Direct DOM click is not the agent hit test. |
| Screenshot | The PNG must contain the fixture navy background `#123`, a red canvas border, and a black canvas fill. |

A path is usable only when every trial clicks, every screenshot passes, and no trial fails to launch. Usability gates the win. A path that cannot click and cannot render the fixture cannot win, even if it is faster or smaller. When both CLI paths are usable, the winner is the one that wins more categories. A category is a tie when the two medians differ by less than 5%. Direct CDP numbers do not decide the contest.

Copy `results.json` and one screenshot from each CLI engine into `results/validation/<os>-<arch>-agent-vs-lightpanda/`.

## Five loops, only if agent-browser won

Skip this section when Lightpanda wins or the contest is a tie.

The workload is five iterations of open, interactive snapshot, ref fill, ref click, read the result text, and screenshot. Repeat each candidate twice. Keep a lever only when every loop still passes the click and the screenshot check, and one of these is true:

- median total time drops at least 5%, or
- memory drops at least 10% and total time slows by no more than 3%, or
- the first loop drops at least 8% and total time slows by no more than 3%.

Apply levers one at a time, on top of levers already kept:

1. Reuse one daemon and browser for all five loops.
2. After the snapshot, batch fill, click, read, and screenshot in one CLI process.
3. `--no-webmcp`.
4. Extra Chromium launch flags, including `--disable-gpu`.
5. Compact interactive snapshot.

```sh
node optimize.mjs
```

Leave the session open between agent commands when reuse wins. A lever that wins on one run and falls inside noise on the next stays out of the launcher. Measure the `node agent.mjs --fast shell` wrapper on the same five reused loops, and remove startup work that runs before the browser path is known. The pinned Chrome path does not need `@puppeteer/browsers` at runtime.

Copy the optimizer report and the wrapper measurement into the same validation directory.

## Long form

`fixture/residency-application.html` is the International Research Residency application: 13 sections, about 10,300 pixels tall, 121 scored answers. Drive it with agent commands. Do not assign values with `eval` or by writing element properties.

```sh
node fill-form.mjs
```

For each section, scroll the section into view, take `snapshot -i` scoped to that section, match the control by role and accessible name to `ref=eN`, scroll that ref into view, then `fill`, `select`, or `check`. Chrome date and month inputs appear as repeated Month, Day, and Year spin buttons. Filling one part returns `malformed_value` and expects `YYYY-MM-DD` or `YYYY-MM`. Set those with `fill #id` and the full value. That is still an agent-browser fill.

Lightpanda's combobox accessible name concatenates the label and every option. Accept a name that starts with the label and then continues. Radios and checkboxes still go through `check` on the ref. Do not click **Clear form**.

Score `window.dumpApplication()` against the answer key after Submit. Count these as correct only when they keep their original values:

- `#application-id` stays the read-only `APP-2026-00421`
- `#staff-only` stays the disabled `INTERNAL`
- `#instructions-read` stays checked
- `#mail-line2`, `#job1-end`, `#same-as-home`, `#job2-current`, the unused language boxes, `#marketing`, and `#behalf` stay empty

Success is `#success` visible and not hidden. The heading alone is not a receipt. An engine that leaves required radios or checkboxes blank has not submitted.

Copy `results.json`, the Shell receipt screenshot, the top-of-form screenshot, and the Lightpanda after-submit screenshot into `results/validation/<os>-<arch>-long-form/`.

## Kitesurf, as an extra engine

Kitesurf is Apache-2.0 and lives at `https://github.com/cloudflare/kitesurf`. It is not an `--engine` value. A trial starts `ghcr.io/cloudflare/kitesurf` with host networking, waits for `http://127.0.0.1:8787/health`, and attaches agent-browser with `connect ws://127.0.0.1:8787/devtools/browser`. Direct trials use that same WebSocket. The local process is workerd, which Cloudflare does not treat as a hardened sandbox, so open only this lab's fixture.

```sh
node compare.mjs --rounds 10 --paths direct-kitesurf,cli-kitesurf --label kitesurf
node fill-form.mjs --engine kitesurf
```

Score it with the same click, screenshot, and 121-answer rules. Keep it out of the Shell versus Lightpanda winner gate. Cold time includes starting a new container. Report RSS when workerd hides its proportional set size.

## Publish

Update `README.md` with the machine, the Asia/Shanghai timestamp, the table, and the winner. State action failures and the error text. Commit the validation copies and this prompt. `results/runs/` stays gitignored.

Do not treat a text-only Lightpanda screenshot as a rendered page. Do not treat a direct DOM click as an agent click. Do not drop the first trial as a warmup.
