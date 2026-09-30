"""Summarize saved evaluations without making any model calls."""

import argparse
import json
import statistics
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report_directory", type=Path)
    parser.add_argument("--expected-repeats", type=int, default=1)
    parser.add_argument(
        "--case-set", choices=("baseline", "additional"), default="baseline"
    )
    args = parser.parse_args()
    if args.expected_repeats < 1:
        parser.error("--expected-repeats must be positive")
    cases = json.loads(
        Path(__file__)
        .with_name(
            {"baseline": "cases.json", "additional": "cases_additional_review.json"}[
                args.case_set
            ]
        )
        .read_text()
    )
    reports = [
        json.loads(path.read_text())
        for path in sorted(args.report_directory.glob("*.json"))
    ]
    expected = {
        (case["id"], mode, repeat)
        for case in cases
        for mode in ("reference_prefix", "rolling")
        for repeat in range(1, args.expected_repeats + 1)
    }
    keys = [(row["case"], row["mode"], row["repeat"]) for row in reports]
    missing = expected - set(keys)
    unexpected = set(keys) - expected
    duplicate_count = len(keys) - len(set(keys))
    print("# Diana conversation evaluation\n")
    print(
        f"Reports: {len(reports)} / expected {len(expected)}. "
        f"Missing: {len(missing)}. Unexpected: {len(unexpected)}. Duplicates: {duplicate_count}.\n"
    )
    if missing or unexpected or duplicate_count:
        print(
            "**Coverage is incomplete or inconsistent; do not treat this as a complete suite result.**\n"
        )
    passed = sum(row["status"] == "pass" for row in reports)
    failed = sum(row["status"] == "fail" for row in reports)
    errors = len(reports) - passed - failed
    print(
        f"Passed: {passed}. Quality failures: {failed}. Errors/incomplete: {errors}.\n"
    )
    if reports:
        print(
            f"Observed pass rate (errors retained in denominator): {passed / len(reports):.1%}.\n"
        )
    print("| Scenario | Mode | Passed / reports | Lowest turn mean | Critical flags |")
    print("|---|---|---:|---:|---|")
    for case in cases:
        for mode in ("reference_prefix", "rolling"):
            group = [
                row
                for row in reports
                if row["case"] == case["id"] and row["mode"] == mode
            ]
            scores = [
                turn["mean_score"]
                for row in group
                for turn in row["turns"]
                if "mean_score" in turn
            ]
            flags = sorted(
                {
                    flag
                    for row in group
                    for turn in row.get("judge_verdict", {}).get("turns", [])
                    for flag in turn.get("critical_flags", [])
                }
            )
            lowest = f"{min(scores):.2f}" if scores else "—"
            print(
                f"| {case['id']} | {mode} | {sum(row['status'] == 'pass' for row in group)} / {len(group)} "
                f"| {lowest} | {', '.join(flags) or '—'} |"
            )
    turns = [turn for row in reports for turn in row["turns"]]
    if turns:
        print(
            f"\nMedian reply length: {statistics.median(turn['word_count'] for turn in turns):g} words."
        )
        print(
            f"Median full text-generation time: {statistics.median(turn['generation_seconds'] for turn in turns):.2f}s."
        )
        print(
            "This is not voice latency or time to first audio. Length and timing are descriptive, not quality scores."
        )
    print(
        "\nHuman review remains pending unless separately documented. Inspect evidence in the JSON reports; "
        "automated scores alone do not establish human-like conversation quality."
    )


if __name__ == "__main__":
    main()
