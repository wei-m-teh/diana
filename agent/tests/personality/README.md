# Personality slider regression evaluation

`cases.json` contains one two-turn conversation per trait. Change one trait to
10, 50 or 90 while holding the others at 50. Generate two rolling conversations
per setting for each prompt version (60 conversations / 120 replies total).
These scenarios are separate from the current prompt's illustrative examples.

The runner uses the configured OpenRouter conversation model with reasoning off.
An independently configured judge scores anonymized, shuffled conversations;
it cannot see slider targets or prompt versions. Keep
`DIANA_EVAL_JUDGE_MODEL=anthropic/claude-opus-5.5` for the user's chosen judge.
It evaluates trait expression (0-100), conversational naturalness (1-5), and
boundary failures. The saved user calibration rules inform judging. The report
contains actual dialogues, evidence, model IDs, settings and prompt hashes.
No real user conversations, private profiles, or secrets are sent in the test.

Initial regression gates for each trait: mean high score exceeds mean low by at
least 15 points, middle score falls between the extremes, mean naturalness is at
least 3.5, and no judged boundary failures. The runner exits nonzero on failed
gates or evaluation errors. These are product heuristics, not validated clinical
personality measurements. One scenario and two samples per level cannot establish
reliability in all situations, mixed traits, long conversations or other languages.
The run isolates wording; it does not test tools, voice expressiveness or latency.

Before a prompt change, snapshot the existing prompts (no API calls):

```sh
PYTHONPATH=agent/src uv run --project agent python agent/tests/personality/snapshot.py /tmp/personality-before.json
```

After editing, configure the existing OpenRouter credentials and model securely,
then explicitly opt into the paid run:

```sh
DIANA_RUN_PERSONALITY_EVAL=1 \
DIANA_PERSONALITY_BASELINE=/tmp/personality-before.json \
DIANA_PERSONALITY_REPORT=agent/eval-results/personality-comparison.json \
DIANA_EVAL_JUDGE_MODEL=anthropic/claude-opus-5.5 \
PYTHONPATH=agent/src uv run --project agent python agent/tests/personality/evaluate.py
```

Optional `DIANA_PERSONALITY_REUSE_BEFORE` points at a completed earlier report to
reuse its baseline generations while generating the new candidate again. All
conversations are rejudged together blind. Only reuse a report for the same model,
scenarios, baseline prompts and repeat count. Reports are kept under the ignored
`agent/eval-results/` directory; cases, runner and regression criteria are tracked.
