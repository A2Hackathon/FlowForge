# Pipeline trigger auth — which GitLab CI/CD variable name?

## Duo / agent workload: use shell path first

**`.gitlab/duo/agent-config.yml`** triggers the pipeline with **`curl`** when **`FLOWFORGE_GITLAB_TRIGGER_TOKEN`** or **`FLOWFORGE_GITLAB_API_TOKEN`** is set. That uses the **Runner’s** environment variables directly, so it still works if the job checked out an **old commit** where `scripts/trigger-pipeline.js` was outdated (a common reason “nothing changed” in logs).

The **`node scripts/trigger-pipeline.js`** fallback only runs when **both** variables are unset.

## `GITLAB_TOKEN` vs `FLOWFORGE_GITLAB_API_TOKEN` elsewhere in the repo

| Area | Uses |
|------|------|
| **`src/store/tokenStore.js` → `getAccessToken()`** (CLI scan, `cli.js`, GitLab API) | **`FLOWFORGE_GITLAB_API_TOKEN` first**, then **`GITLAB_TOKEN`**, then **`CI_JOB_TOKEN`** in CI. |
| **`scripts/trigger-pipeline.js`** | **`FLOWFORGE_GITLAB_TRIGGER_TOKEN`** / **`FLOWFORGE_GITLAB_API_TOKEN`** first; **`GITLAB_TOKEN`** only as fallback (blocked in Runner jobs unless allow flag). |
| **`.gitlab/duo/agent-config.yml`** (post-CLI trigger) | **`curl`** + **`FLOWFORGE_*`** vars only; no `GITLAB_TOKEN` for pipeline create. |
| **Docs / `.env.example`** | Mention both names for clarity. |

GitLab Duo still **injects** a **`GITLAB_TOKEN`** for agents; that is **not** your Project access token. Use **`FLOWFORGE_GITLAB_API_TOKEN`** for your real **`glpat-...`** so both **scan** and **pipeline trigger** can use the same variable.

### What you’ll see in job logs (no secrets)

- **`.gitlab/duo/agent-config.yml`** prints **`[flowforge] CI env visibility`** with **length** of `FLOWFORGE_GITLAB_API_TOKEN` if set, or **NOT visible** if not.
- **`scripts/trigger-pipeline.js`** prints **`FLOWFORGE_GITLAB_API_TOKEN: visible to this process, length=N`** or **`NOT visible`**.

If **`NOT visible`**, the variable is missing in that job: wrong project, **Protected** variable on an unprotected branch, or **environment scope** mismatch.

### Don’t see `[flowforge] CI env visibility` at all?

The Duo workload job checks out a **specific commit** (often `refs/workloads/...` → detached HEAD). If that commit is **older** than the FlowForge files that add the shell + `curl` block, you will **not** see those lines — you may see only `apk add ... git` (no **`curl`**), the old banner `=== FlowForge: post-CLI pipeline trigger ===` (without **`(shell + curl)`**), and **`[trigger-pipeline] auth: PRIVATE-TOKEN from GITLAB_TOKEN`** from an older `scripts/trigger-pipeline.js`.

#### Frozen workload snapshot (why push to `main` didn’t help)

**Runtime check:** In the job log, find **`Getting source from Git repository`** → **`Checking out <sha> as detached HEAD (ref is refs/workloads/...)`**.

- If **`<sha>` is always the same** across runs (e.g. **`bada3472`** every time) while **`main`** on GitLab has **newer** commits, the flow is **not** using your latest pushed tree for that workload. Re-running the **same** Duo workload / pipeline can keep the **same** `refs/workloads/<id>` snapshot.
- **Pushing to `default branch` alone does not rewrite** an existing workload ref’s checkout; you need a workload run whose snapshot includes your new commits.

**What to do:**

1. In the GitLab UI, open **Repository** and confirm **`main`** (or your default branch) actually contains the updated **`.gitlab/duo/agent-config.yml`** (e.g. **`apk add ... git curl`**, **`(shell + curl)`** in the echo).
2. Trigger the flow in a way that starts a **new** workload (new run), not only “retry job” on an old workload pipeline — watch for a **new** `refs/workloads/...` value or a **new** short SHA in **`Checking out ...`** matching **`main`**.
3. If the SHA **never** updates, try **recreating** or **re-saving** the Duo flow (project **Automate → Flows**), or open a **new** issue/MR/chat that invokes the flow per GitLab’s behavior for your tier — you need a run that resolves **`main` HEAD** (or the branch you care about) into the workload checkout.
4. After it works, the log should show **`git curl`**, **`[flowforge] workload commit CI_COMMIT_SHORT_SHA=...`**, **`(shell + curl)`**, then **`[flowforge] CI env visibility`**.

---

## `scripts/trigger-pipeline.js` (fallback / local)

The script reads **environment variables by exact name**. Use this table when configuring **Settings → CI/CD → Variables**.

| Priority | Variable name (Key) | Secret type | How the script uses it |
|----------|----------------------|-------------|-------------------------|
| **1** | **`FLOWFORGE_GITLAB_TRIGGER_TOKEN`** | Pipeline trigger (`glptt-...`) | `POST /projects/:id/trigger/pipeline` |
| (alias) | **`GITLAB_TRIGGER_TOKEN`** | Same as above | Same as row 1 |
| **2** | **`FLOWFORGE_GITLAB_API_TOKEN`** | Project access token (`glpat-...`) | `PRIVATE-TOKEN` header on `POST /projects/:id/pipeline` |
| **3** | **`GITLAB_TOKEN`** | Fallback | **Not used** inside GitLab Runner jobs (Duo/CI inject a different value). Use row 2 instead. |
| **4** | **`CI_JOB_TOKEN`** | Injected by Runner | `JOB-TOKEN` header — often **401** for creating pipelines |

**Your log said `PRIVATE-TOKEN from GITLAB_TOKEN`** → the script chose **`GITLAB_TOKEN`** because **`FLOWFORGE_GITLAB_API_TOKEN` was empty** in that job. The value at runtime is usually **Duo’s injected token**, not your Project access token.

**Fix:** Add variable **`FLOWFORGE_GITLAB_API_TOKEN`** (masked) = your **`glpat-...`** from **Settings → Access tokens** (with `api` scope). The script checks **`FLOWFORGE_GITLAB_API_TOKEN` before `GITLAB_TOKEN`**.

Optional: **`FLOWFORGE_GITLAB_TRIGGER_TOKEN`** = token from **Settings → CI/CD → Pipeline triggers** (no PAT needed).
