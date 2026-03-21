# GCP permissions for GitLab deploy jobs

The pipeline uses a **service account key** (`GCP_SERVICE_ACCOUNT_KEY`) and:

1. **`registry-prep`** — ensures an **Artifact Registry** Docker repository exists (named `GAR_REPOSITORY`, default `flowforge-ci` in `us-central1`). Without a repo (or without **create-on-push** IAM), Kaniko fails with `DENIED: ... Creating on push requires the artifactregistry.repositories.createOnPush permission`.
2. **`build-container` (Kaniko)** — builds the `Dockerfile` and **pushes** to **`REGION-docker.pkg.dev/PROJECT/REPO/IMAGE:TAG`** (not legacy `gcr.io/...` in CI) **without** `gcloud builds submit`, so it does **not** use Cloud Build’s default staging bucket `gs://<PROJECT_ID>_cloudbuild`. This avoids many “forbidden … \_cloudbuild” IAM issues.
3. **`deploy-cloud-run`** — `gcloud run deploy` with that image.

## 0. How to get `GCP_SERVICE_ACCOUNT_KEY`

This repo’s CI expects **`GCP_SERVICE_ACCOUNT_KEY`** to be the **base64-encoded** contents of a **JSON key** for a deploy service account (the job runs `echo "$GCP_SERVICE_ACCOUNT_KEY" | base64 -d > key.json`).

### Console (typical)

1. Open [IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) for your **GCP project**.
2. **Create** a service account (or pick an existing one), e.g. `flowforge-deploy`.
3. Grant it the **roles** in [§2 IAM roles](#2-iam-roles-for-the-deploy-service-account) below (adjust to least privilege).
4. Open that service account → **Keys** → **Add key** → **Create new key** → **JSON** → download the file. **Anyone with this file can use the SA** — store it only in GitLab masked/protected variables or a secret manager.
5. **Encode for GitLab** (no newlines in the variable value if possible):
   - **Linux / macOS:** `base64 -w0 key.json` (GNU) or `base64 key.json | tr -d '\n'` (BSD).
   - **Windows PowerShell:**  
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\key.json"))`
6. In GitLab: **Settings → CI/CD → Variables** → add **`GCP_SERVICE_ACCOUNT_KEY`** = that string, **masked** and **protected** if you use protected branches. Also set **`GCP_PROJECT_ID`** to your numeric or string project id.

### `gcloud` (optional)

```bash
# Create SA (name as you prefer)
gcloud iam service-accounts create flowforge-deploy --display-name="FlowForge deploy"

# Grant roles (example — align with §2)
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:flowforge-deploy@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

# Create JSON key file
gcloud iam service-accounts keys create key.json \
  --iam-account=flowforge-deploy@YOUR_PROJECT_ID.iam.gserviceaccount.com

base64 -w0 key.json   # paste into GitLab as GCP_SERVICE_ACCOUNT_KEY
```

**Org policy:** Some orgs **disable user-managed SA keys**. Then use **Workload Identity Federation** (or OIDC) to GitLab instead of a long-lived key — that requires different CI steps than this file’s `base64 -d` pattern.

If you still use **`gcloud builds submit`** locally, that path **does** use the `_cloudbuild` bucket and needs extra Storage/Cloud Build permissions.

**Service Usage Admin** ≠ **Service Usage Consumer**. The error `serviceusage.services.use` is fixed by **`roles/serviceusage.serviceUsageConsumer`** (or a broader role). **Service Usage Admin** enables/disables APIs for the project but does **not** grant “consume enabled APIs” for the service account the same way.

If you see **forbidden from accessing the bucket …\_cloudbuild** (only when using **`gcloud builds submit`**), switch to the repo’s **Kaniko** `build-container` job (no Cloud Build staging bucket) or add the Storage roles below for that bucket.

If you see **Cloud Resource Manager API** disabled: enable it in [Google Cloud Console](https://console.cloud.google.com/apis/library/cloudresourcemanager.googleapis.com) for the **same** project as `GCP_PROJECT_ID`, wait a few minutes, retry.

If you see **forbidden from accessing the bucket …\_cloudbuild** or **serviceusage.services.use**:

## 1. Enable APIs (project owner / Editor)

In **APIs & Services → Library**, enable at least:

| API | Used for |
|-----|----------|
| **Cloud Resource Manager** | Project metadata, `gcloud config set project` |
| **Cloud Build** | `gcloud builds submit` |
| **Artifact Registry** | Storing images (`REGION-docker.pkg.dev/...` in CI; enable `artifactregistry.googleapis.com`) |
| **Cloud Run** | Deploy |
| **Service Usage** | Using enabled APIs as a service account |

## 2. IAM roles for the deploy service account

In **IAM & Admin → IAM**, select your deploy service account (e.g. `flowforge-deploy@...`) and add **project-level** roles (principle of least privilege: start broad, then narrow):

| Role | Why |
|------|-----|
| **Service Usage Consumer** (`roles/serviceusage.serviceUsageConsumer`) | Satisfies `serviceusage.services.use` |
| **Cloud Build Editor** (`roles/cloudbuild.builds.editor`) | Submit Cloud Build jobs |
| **Storage Object Admin** (`roles/storage.objectAdmin`) | Read/write objects in build buckets (including `*_cloudbuild`) |
| **Artifact Registry Administrator** (`roles/artifactregistry.admin`) | Create the Docker repo (`registry-prep`) and push images (Kaniko). Narrower: pre-create the repo in Console and grant **Artifact Registry Writer** (`roles/artifactregistry.writer`) only if you do not use automatic repo creation. |
| **Cloud Run Admin** (`roles/run.admin`) | Deploy to Cloud Run |
| **Service Account User** (`roles/iam.serviceAccountUser`) | On the **runtime** service account Cloud Run uses (often default compute SA) |

If builds still fail on the bucket, add **Storage Admin** (`roles/storage.admin`) temporarily to confirm, then replace with Object Admin scoped to the bucket if your org allows.

## 3. Organization policy

If your **organization** restricts bucket access or service accounts, an org admin may need to allow Cloud Build / Storage for this project.

## 4. Verify

```bash
gcloud auth activate-service-account --key-file=key.json
gcloud config set project YOUR_PROJECT_ID
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/test:manual .
```

(From a machine with Docker source context; same as CI.)

---

**Note:** The pipeline uses **Artifact Registry** URLs (`us-central1-docker.pkg.dev/...` by default). If Kaniko still reports **DENIED** on push, confirm **Artifact Registry API** is enabled and the service account can **create** the repository (via `registry-prep`) and **write** images. Legacy **`gcr.io`** pushes often map to Artifact Registry permissions today; using `docker.pkg.dev` and `registry-prep` avoids the “repo does not exist / createOnPush” failure when the SA only had **Artifact Registry Writer** on an empty project.

### Troubleshooting: `GET https://gcr.io/v2/token … DENIED: gcr.io repo does not exist`

That request means **Kaniko is still pushing to a `gcr.io/PROJECT/…` image URL** (legacy Container Registry path). This repo’s CI should write **`REGION-docker.pkg.dev/PROJECT/REPO/IMAGE:TAG`** into `deploy-image.txt` via `scripts/ci-write-deploy-image.js`.

1. **Merge/push** the latest `.gitlab-ci.yml` and `scripts/ci-write-deploy-image.js` so the **`gcp-plan`** job regenerates `deploy-image.txt` (not `gcr.io`).
2. Confirm **`registry-prep`** runs before **`build-container`** and creates the **`flowforge-ci`** Docker repository (or set **`GAR_REPOSITORY`** / **`GCP_REGION`** consistently in CI variables).
3. If you **must** use `gcr.io`, you need legacy **Container Registry** setup and IAM for that path — prefer Artifact Registry + `docker.pkg.dev` instead.
