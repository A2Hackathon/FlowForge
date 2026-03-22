# GitLab CI + GCP service account (quick setup)

This repo’s pipeline uses a **Google Cloud service account** (SA) stored in GitLab — **not** your personal Google login. Jobs run `gcloud` and Kaniko using that key.

## 1. Variables to add in GitLab

**Project → Settings → CI/CD → Variables** (expand **Variables**).

| Key | Value | Notes |
|-----|--------|--------|
| **`GCP_PROJECT_ID`** | Your GCP project ID (string or number) | Required for `gcp-plan` and deploy jobs. |
| **`GCP_SERVICE_ACCOUNT_KEY`** | Base64 of the **JSON key file** (single line, no newlines) | Required for `registry-prep`, `build-container`, `deploy-cloud-run`. **Masked** + **Protected** if you use protected branches. |

How to base64 the JSON key:

- **Linux (GNU):** `base64 -w0 key.json`
- **macOS:** `base64 key.json | tr -d '\n'`
- **Windows PowerShell:**  
  `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\key.json"))`

Paste the **entire** output as the variable value (the jobs run `echo "$GCP_SERVICE_ACCOUNT_KEY" | base64 -d > key.json`).

Optional: **`GITLAB_TOKEN`** as a project access token (`glpat-...`) if `gcp-plan` needs API access beyond the default CI token — see `.gitlab-ci.yml` comments.

## 2. Create the service account and key (GCP Console)

1. Open **[IAM & Admin → Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)** for **`GCP_PROJECT_ID`**.
2. **Create** a service account (e.g. `flowforge-deploy`).
3. Grant IAM roles — see **`docs/GCP_DEPLOY_IAM.md`** (Artifact Registry, Cloud Run, etc.).
4. **Keys → Add key → JSON** → download → base64 as above → GitLab variable **`GCP_SERVICE_ACCOUNT_KEY`**.

If your org **disables user-managed keys**, use **Workload Identity Federation** instead; that needs different CI steps than this repo’s `base64 -d` pattern (see **`GCP_DEPLOY_IAM.md`**).

## 3. Run the pipeline

1. **Push to `main` or `master`** (or **Run pipeline** on that ref).  
   Deploy jobs use **`only: main` / `master`** — other branches won’t run them.
2. Wait for **`gcp-plan` → `registry-prep` → `build-container`** to finish (they run automatically).
3. **`deploy-cloud-run`** is **`when: manual`**: open the pipeline → click **Play** on that job to run `gcloud run deploy`. The job log prints **`=== Cloud Run service URL ===`** followed by the live HTTPS URL (`gcloud run services describe … --format="value(status.url)"`).

To make Cloud Run deploy **automatic** again (no Play), remove `when: manual` from **`deploy-cloud-run`** in **`.gitlab-ci.yml`**.

## 4. Related docs

- **`docs/GCP_DEPLOY_IAM.md`** — IAM roles, Artifact Registry, troubleshooting.
- **`docs/TRIGGER_PIPELINE_AUTH.md`** — triggering a pipeline from Duo/scripts (`FLOWFORGE_GITLAB_*`).
