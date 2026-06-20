#!/usr/bin/env python3
"""
Snapshot Generator for AWX Job Detail Contract (v1.0)

Reads raw AWX API job response fixtures and generates contract-compliant
JSON snapshots. These snapshots are the ground truth for the TypeScript
contract types — the contract.test.ts validates that TypeScript can
produce output matching these snapshots.

Usage:
    python3 scripts/generate-snapshots.py

Fixtures:
    tests/fixtures/awx_job_success.json   → tests/contracts/__snapshots__/awx_job_success.json
    tests/fixtures/awx_job_partial.json   → tests/contracts/__snapshots__/awx_job_partial.json
    tests/fixtures/awx_job_failure.json   → tests/contracts/__snapshots__/awx_job_failure.json

Regenerate after updating fixtures:
    python3 scripts/generate-snapshots.py
"""

import json
import os
import sys
from pathlib import Path


def transform_job_to_contract(raw: dict) -> dict:
    """Transform a raw AWX API job response into the v1.0 contract format."""

    summary = raw.get("summary_fields", {})
    host_counts = raw.get("host_status_counts", {})

    # Derived boolean flags
    status = raw.get("status", "unknown")
    is_successful = status == "successful"
    is_failed = status in ("failed", "canceled", "error")
    has_unreachable_hosts = host_counts.get("unreachable", 0) > 0

    # Warnings: collect from job_explanation if non-empty
    warnings = []
    if raw.get("job_explanation", "").strip():
        warnings.append(raw["job_explanation"])

    # Errors: collect from result_traceback if present
    errors = []
    result_traceback = raw.get("result_traceback", "")
    if result_traceback.strip():
        errors.append(result_traceback)

    # Extract credential names safely
    credentials = summary.get("credentials", [])
    credential_names = [c["name"] for c in credentials] if isinstance(credentials, list) else []

    # Extract label names safely (nested under results)
    labels_data = summary.get("labels", {})
    if isinstance(labels_data, dict):
        label_results = labels_data.get("results", [])
        label_names = [lb["name"] for lb in label_results] if isinstance(label_results, list) else []
    else:
        label_names = []

    output = {
        "schema_version": "1.0",
        "job": {
            "id": raw.get("id"),
            "name": raw.get("name", ""),
            "status": raw.get("status", "unknown"),
            "failed": raw.get("failed", False),
            "job_type": raw.get("job_type", ""),
            "playbook": raw.get("playbook", ""),
            "created": raw.get("created", ""),
            "started": raw.get("started", None),
            "finished": raw.get("finished", None),
            "elapsed": raw.get("elapsed", None),
            "execution_node": raw.get("execution_node", ""),
            "controller_node": raw.get("controller_node", ""),
            "scm_branch": raw.get("scm_branch", ""),
            "verbosity": raw.get("verbosity", 0),
            "forks": raw.get("forks", None),
            "limit": raw.get("limit", ""),
        },
        "related": {
            "inventory_name": summary.get("inventory", {}).get("name", ""),
            "project_name": summary.get("project", {}).get("name", ""),
            "job_template_name": summary.get("job_template", {}).get("name", ""),
            "instance_group_name": summary.get("instance_group", {}).get("name", ""),
            "created_by": summary.get("created_by", {}).get("username", ""),
            "credential_names": credential_names,
            "label_names": label_names,
        },
        "host_status_counts": {
            "ok": host_counts.get("ok", 0),
            "failed": host_counts.get("failed", 0),
            "skipped": host_counts.get("skipped", 0),
            "changed": host_counts.get("changed", 0),
            "unreachable": host_counts.get("unreachable", 0),
        },
        "derived": {
            "is_successful": is_successful,
            "is_failed": is_failed,
            "has_unreachable_hosts": has_unreachable_hosts,
        },
        "warnings": warnings,
        "errors": errors,
    }

    return output


def main():
    package_dir = Path(__file__).resolve().parent.parent
    fixtures_dir = package_dir / "tests" / "fixtures"
    snapshots_dir = package_dir / "tests" / "contracts" / "__snapshots__"

    snapshots_dir.mkdir(parents=True, exist_ok=True)

    fixtures = {
        "awx_job_success": fixtures_dir / "awx_job_success.json",
        "awx_job_partial": fixtures_dir / "awx_job_partial.json",
        "awx_job_failure": fixtures_dir / "awx_job_failure.json",
    }

    for name, fixture_path in fixtures.items():
        if not fixture_path.exists():
            print(f"ERROR: Fixture file not found: {fixture_path}", file=sys.stderr)
            sys.exit(1)

        with open(fixture_path, "r") as f:
            raw_data = json.load(f)

        contract_output = transform_job_to_contract(raw_data)

        snapshot_path = snapshots_dir / f"{name}.json"
        with open(snapshot_path, "w") as f:
            json.dump(contract_output, f, indent=2)
            f.write("\n")  # trailing newline

        print(f"  ✓ Generated {snapshot_path.name} ({contract_output['job']['status']})")

    print(f"\nSnapshots written to: {snapshots_dir}")


if __name__ == "__main__":
    main()
