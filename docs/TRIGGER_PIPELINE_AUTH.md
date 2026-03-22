# `scripts/trigger-pipeline.js` — which GitLab CI/CD variable name?

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
