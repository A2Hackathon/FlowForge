#!/usr/bin/env python3
"""
Deploy Cloud Run from FlowForge gcp-plan.json.

Reads deploymentConfig from gcp-plan.json, ensures Artifact Registry exists,
builds an image with Cloud Build, and deploys to Cloud Run.
"""

import argparse
import json
import os
import subprocess
import sys


def run(cmd):
    subprocess.run(cmd, check=True)


def load_plan(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def ensure_artifact_repo(project_id, location, repo):
    check = subprocess.run(
        [
            "gcloud",
            "artifacts",
            "repositories",
            "describe",
            repo,
            f"--location={location}",
            f"--project={project_id}",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if check.returncode == 0:
        print(f"Artifact Registry repo exists: {repo} ({location})")
        return

    print(f"Creating Artifact Registry repo: {repo} ({location})")
    run(
        [
            "gcloud",
            "artifacts",
            "repositories",
            "create",
            repo,
            "--repository-format=docker",
            f"--location={location}",
            f"--project={project_id}",
            "--description=FlowForge deploy",
        ]
    )


def build_image(project_id, source_dir, image):
    print(f"Building image with Cloud Build: {image}")
    run(
        [
            "gcloud",
            "builds",
            "submit",
            "--project",
            project_id,
            "--tag",
            image,
            "--quiet",
            source_dir,
        ]
    )


def deploy_cloud_run(project_id, region, cloud_run_cfg, image):
    service_name = cloud_run_cfg.get("serviceName") or "flowforge-service"
    args = [
        "gcloud",
        "run",
        "deploy",
        service_name,
        f"--image={image}",
        f"--region={region}",
        f"--project={project_id}",
        "--platform=managed",
        "--allow-unauthenticated",
        "--quiet",
    ]

    if cloud_run_cfg.get("cpu"):
        args.append(f"--cpu={cloud_run_cfg['cpu']}")
    if cloud_run_cfg.get("memory"):
        args.append(f"--memory={cloud_run_cfg['memory']}")
    if cloud_run_cfg.get("minInstances") is not None:
        args.append(f"--min-instances={cloud_run_cfg['minInstances']}")
    if cloud_run_cfg.get("maxInstances") is not None:
        args.append(f"--max-instances={cloud_run_cfg['maxInstances']}")
    if cloud_run_cfg.get("concurrency") is not None:
        args.append(f"--concurrency={cloud_run_cfg['concurrency']}")

    env_vars = cloud_run_cfg.get("envVars") or []
    pairs = []
    for item in env_vars:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        value = item.get("value")
        if not name or value is None:
            continue
        # Skip unresolved placeholders like ${DB_HOST}
        if isinstance(value, str) and "${" in value:
            continue
        pairs.append(f"{name}={value}")
    if pairs:
        args.append(f"--set-env-vars={','.join(pairs)}")

    print(f"Deploying Cloud Run service: {service_name} ({region})")
    run(args)

    url = subprocess.check_output(
        [
            "gcloud",
            "run",
            "services",
            "describe",
            service_name,
            f"--region={region}",
            f"--project={project_id}",
            "--platform=managed",
            "--format=value(status.url)",
        ],
        text=True,
    ).strip()
    return url


def main():
    parser = argparse.ArgumentParser(description="Deploy to GCP from FlowForge plan")
    parser.add_argument("--plan", default="gcp-plan.json")
    parser.add_argument("--project", default=os.environ.get("GCP_PROJECT_ID"))
    parser.add_argument("--source", default=".")
    parser.add_argument("--tag", default=os.environ.get("CI_COMMIT_SHA", "latest"))
    args = parser.parse_args()

    if not args.project:
        print("Error: set --project or GCP_PROJECT_ID", file=sys.stderr)
        sys.exit(1)

    plan = load_plan(args.plan)
    cfg = plan.get("deploymentConfig") or {}
    cloud_run = cfg.get("cloudRun") or {}
    artifact = cfg.get("artifactRegistry") or {}

    if not cloud_run:
        print("No deploymentConfig.cloudRun found in plan; nothing to deploy.")
        sys.exit(0)

    region = cfg.get("region") or cloud_run.get("region") or "us-central1"
    location = artifact.get("location") or region
    repo = artifact.get("repository") or "flowforge"
    service = cloud_run.get("serviceName") or "flowforge-service"
    image = f"{location}-docker.pkg.dev/{args.project}/{repo}/{service}:{args.tag}"

    ensure_artifact_repo(args.project, location, repo)
    build_image(args.project, args.source, image)
    url = deploy_cloud_run(args.project, region, cloud_run, image)
    print(f"Done. Service URL: {url}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3


import argparse
import json
import os
import subprocess
import sys


def run(cmd: list[str]) -> None:
  subprocess.run(cmd, check=True)


def load_plan(plan_path: str) -> dict:
  with open(plan_path, "r", encoding="utf-8") as f:
    return json.load(f)


def ensure_artifact_repo(project_id: str, location: str, repo: str) -> None:
  # If describe succeeds, repo exists.
  describe = subprocess.run(
    [
      "gcloud",
      "artifacts",
      "repositories",
      "describe",
      repo,
      f"--location={location}",
      f"--project={project_id}",
    ],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
  )
  if describe.returncode == 0:
    print(f"Artifact Registry repository exists: {repo} ({location})")
    return

  print(f"Creating Artifact Registry repository: {repo} ({location})")
  run(
    [
      "gcloud",
      "artifacts",
      "repositories",
      "create",
      repo,
      "--repository-format=docker",
      f"--location={location}",
      f"--project={project_id}",
      "--description=FlowForge deploy",
    ]
  )
  print("Artifact Registry repository created.")


def build_image(project_id: str, image: str, source_dir: str) -> None:
  print(f"Building & pushing image via Cloud Build: {image}")
  run(
    [
      "gcloud",
      "builds",
      "submit",
      "--project",
      project_id,
      "--tag",
      image,
      "--quiet",
      source_dir,
    ]
  )


def deploy_cloud_run(project_id: str, region: str, cloud_run: dict, image: str) -> str:
  service_name = cloud_run.get("serviceName") or "app"

  args = [
    "gcloud",
    "run",
    "deploy",
    service_name,
    f"--image={image}",
    f"--region={region}",
    f"--project={project_id}",
    "--platform=managed",
    "--allow-unauthenticated",
    "--quiet",
  ]

  cpu = cloud_run.get("cpu")
  memory = cloud_run.get("memory")
  min_instances = cloud_run.get("minInstances")
  max_instances = cloud_run.get("maxInstances")
  concurrency = cloud_run.get("concurrency")

  if cpu:
    args.append(f"--cpu={cpu}")
  if memory:
    args.append(f"--memory={memory}")
  if min_instances is not None:
    args.append(f"--min-instances={min_instances}")
  if max_instances is not None:
    args.append(f"--max-instances={max_instances}")
  if concurrency is not None:
    args.append(f"--concurrency={concurrency}")

  env_vars = cloud_run.get("envVars") or []
  # Skip placeholder values like ${DB_HOST} when they haven't been provided.
  # (CI can be extended later to pass real values.)
  set_env = []
  for e in env_vars:
    if not isinstance(e, dict):
      continue
    name = e.get("name")
    value = e.get("value")
    if not name or value is None:
      continue
    if isinstance(value, str) and "${" in value:
      continue
    set_env.append(f"{name}={value}")

  if set_env:
    args.append(f"--set-env-vars={','.join(set_env)}")

  print(f"Deploying to Cloud Run: {service_name} ({region})")
  run(args)

  url = subprocess.check_output(
    [
      "gcloud",
      "run",
      "services",
      "describe",
      service_name,
      f"--region={region}",
      f"--project={project_id}",
      "--platform=managed",
      "--format=value(status.url)",
    ],
    text=True,
  ).strip()

  return url


def main() -> None:
  parser = argparse.ArgumentParser(description="Deploy to GCP from FlowForge gcp-plan.json")
  parser.add_argument("--plan", default="gcp-plan.json", help="Path to gcp-plan.json")
  parser.add_argument("--project", default=os.environ.get("GCP_PROJECT_ID"), help="GCP project ID")
  parser.add_argument("--source", default=".", help="Source directory (must contain Dockerfile)")
  parser.add_argument("--tag", default=os.environ.get("CI_COMMIT_SHA", "latest"), help="Image tag")
  parser.add_argument(
    "--location",
    default=None,
    help="Artifact Registry location override (default: from plan.artifactRegistry.location or plan.region)",
  )
  args = parser.parse_args()

  if not args.project:
    print("Error: set --project or GCP_PROJECT_ID", file=sys.stderr)
    sys.exit(1)

  plan = load_plan(args.plan)
  deployment_config = plan.get("deploymentConfig") or {}
  cloud_run = deployment_config.get("cloudRun") or {}
  artifact_registry = deployment_config.get("artifactRegistry") or {}

  if not cloud_run:
    print("Plan has no deploymentConfig.cloudRun; cannot deploy to Cloud Run.", file=sys.stderr)
    sys.exit(1)

  region = deployment_config.get("region") or cloud_run.get("region") or "us-central1"
  repo_name = artifact_registry.get("repository") or "flowforge"
  location = args.location or artifact_registry.get("location") or region

  service_name = cloud_run.get("serviceName") or "app"
  image = f"{location}-docker.pkg.dev/{args.project}/{repo_name}/{service_name}:{args.tag}"

  ensure_artifact_repo(args.project, location, repo_name)
  build_image(args.project, image, args.source)
  url = deploy_cloud_run(args.project, region, cloud_run, image)

  print(f"Done. Service URL: {url}")


if __name__ == "__main__":
  main()

