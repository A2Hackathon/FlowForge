# Duo flow vs real GCP deploy (why “deployment approved” changes nothing)

## What Duo **cannot** do

- **Open Google Cloud Console or a browser** for the user. Duo Agent workloads run on **headless CI runners** — there is no display, no OAuth popup, and no `gcloud auth login` for a human during the job.
- **Deploy by chat text alone.** Any message like “deployment approved”, “the pipeline may proceed”, or “validation complete” from an **LLM** is **not** a deploy and **not** proof that Cloud Run or Artifact Registry was updated.

If your logs show **`PreConfiguredWorkflow`** / a generic “Deployment Validation Summary”, that reply often comes from **GitLab’s bundled workflow**, not from this repo’s **`.gitlab/duo/flows/flowforge-gcp.yaml`**. Use the FlowForge flow YAML (or edit that workflow’s instructions in GitLab) so the model does **not** claim deployment.

## What actually deploys to GCP

1. **A project CI/CD pipeline** runs on your repo (not only the Duo workload pipeline).  
   - Typically after a **push to `main`**, a **manual pipeline**, or a successful **`scripts/trigger-pipeline.js`** / **`curl`** step from **`.gitlab/duo/agent-config.yml`** (with valid **`FLOWFORGE_*`** tokens — see **`TRIGGER_PIPELINE_AUTH.md`**).
2. Jobs like **`deploy-cloud-run`** use **non-interactive** GCP auth:
   - **`GCP_SERVICE_ACCOUNT_KEY`** (base64 JSON) and **`GCP_PROJECT_ID`** in **Settings → CI/CD → Variables**, or  
   - **Workload Identity Federation** / OIDC (no long-lived key) if you change the pipeline accordingly.

See **`GCP_DEPLOY_IAM.md`** for roles and how to create the service account key.

## End-to-end checklist (what “deploy everything” means in practice)

| Step | Where |
|------|--------|
| User authenticates to GCP **once** (browser) | Your machine or GCP Console — to create a service account + key or configure WIF |
| Store secrets in GitLab | **Settings → CI/CD → Variables** (`GCP_PROJECT_ID`, `GCP_SERVICE_ACCOUNT_KEY`, …) |
| Ensure pipeline runs | **CI/CD → Pipelines** — a run that includes **`deploy-cloud-run`** (or your deploy job) **succeeds** |
| Duo workload | Runs **planning** + optional **trigger** of the project pipeline — it does **not** replace the deploy job |

## If you want a “click to deploy” experience

That is **outside** GitLab CI: e.g. **Cloud Console** “Deploy” buttons, **Cloud Run** UI, or **`gcloud`** on your laptop after `gcloud auth login`. FlowForge’s design is **GitOps**: deploy via **GitLab CI** with stored credentials, not interactive login inside Duo.
