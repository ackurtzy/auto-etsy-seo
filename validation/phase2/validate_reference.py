"""Compare the production TypeScript method with the independent Python reference."""

from __future__ import annotations

import json
import math
from pathlib import Path
import subprocess

from reference import reference_results


ROOT = Path(__file__).resolve().parents[2]


def compare_number(left: float, right: float, label: str) -> None:
    if not math.isclose(left, right, rel_tol=1e-9, abs_tol=1e-10):
        raise AssertionError(f"{label}: TypeScript={left} Python={right}")


def main() -> int:
    completed = subprocess.run(
        ["node", "validation/phase2/run_ts_reference.ts"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    typescript = json.loads(completed.stdout)
    python = reference_results()
    if [item["case_id"] for item in typescript["results"]] != [item["case_id"] for item in python["results"]]:
        raise AssertionError("reference case identities differ")
    for ts_case, py_case in zip(typescript["results"], python["results"], strict=True):
        label = ts_case["case_id"]
        if ts_case["assignment_count"] != py_case["assignment_count"]:
            raise AssertionError(f"{label}: assignment count differs")
        compare_number(ts_case["estimate"], py_case["estimate"], f"{label} estimate")
        compare_number(ts_case["p_value"], py_case["p_value"], f"{label} p-value")
        if ts_case["interval"]["status"] != py_case["interval"]["status"]:
            raise AssertionError(f"{label}: interval availability differs")
        if ts_case["interval"]["status"] == "available":
            for field in ("lower", "upper", "standardError", "degreesOfFreedom"):
                compare_number(ts_case["interval"][field], py_case["interval"][field], f"{label} interval {field}")
    print(json.dumps({"status": "passed", "cases": len(typescript["results"]), "tolerance": "1e-9 relative"}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
