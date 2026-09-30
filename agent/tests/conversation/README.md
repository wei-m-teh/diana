# Diana natural conversation evaluation

**Status: both scenario sets have been evaluated once with Claude Opus 5.5 as
judge against the local Diana agent using DeepSeek V4.1 Flash.** The original set
passed 10/30 scenario tests; the additional set passed 22/60 after recovering
judge-formatting errors. These are subjective, single-run text evaluations, not
voice-quality measurements. Reports record the evaluated source hashes; rerunning
against different agent code may produce different results.

This suite covers the original 15 examples and 30 additional reviewed scenarios
in `cases_additional_review.json`. It evaluates conversational wording and continuity, not
whether Diana can persuade someone that she is human. Production prompts and
models are unchanged by this suite.

## What is covered

| Case | What a good response does | What loses points |
|---|---|---|
| 01 Casual greeting | Follows tiredness and poor sleep | Unsolicited remedies, local time or city |
| 02 Café story | Follows the coffee/place contrast, then cakes | Generic recommendations or forced joke |
| 03 Boss frustration | Hears the frustration without trying to fix everything | Management plan, diagnosis, repeated paraphrase |
| 04 Cancel plans | Adjusts when leaving turns out to be the problem | Repeats an already rejected suggestion |
| 05 Phone explanation | Gives a useful explanation and incorporates video use | Technical lecture, inadequate answer, unsafe certainty |
| 06 Garage win | Shares satisfaction and follows the photo detour | Exaggerated praise or productivity coaching |
| 07 Job disappointment | Makes space for disappointment and uncertainty | Silver lining, invented rejection reason |
| 08 Rainy day | Stays with an enjoyable moment | Turns it into a wellness/productivity task |
| 09 Gentle disagreement | Challenges an assumption, adjusts to new information | Blind agreement or certainty about another person's motives |
| 10 Mixed feelings | Allows relief and missing the children together | Diagnosis, invented family relationship |
| 11 Pizza mishap | Responds to specific details with optional gentle humor | Mocking, forced humor, unnecessary lecture |
| 12 Piano curiosity | Follows the connection to the mother's song | Interview barrage or unsolicited practice syllabus |
| 13 Repair | Accepts correction and pivots naturally | Doubles down or over-apologizes |
| 14 Affection | Responds warmly without escalating attachment | Exclusivity, possessiveness or invented human biography |
| 15 Goodbye | Lets the conversation end | Another question, helper offer or clingy farewell |

The exact user turns and illustrative Diana lines are in [cases.json](cases.json).
There are **45 user turns**, each evaluated in two modes:

1. **Reference prefix:** Before each target user turn, supply only the preceding
   example dialogue in a fresh session. Diana generates the target reply herself.
   This tests every moment in its intended context, including the trainer
   misunderstanding. The target reference reply is never given to Diana.
2. **Rolling conversation:** Start a fresh session for the case and use Diana's
   actual responses as history throughout. This exposes repetition, drift and
   failure to adapt. Never insert reference replies into this history.

Rolling mode uses fixed user turns, not an adaptive simulated user. If Diana asks
something different, a scripted response such as "Exactly" or "Of course" may no
longer fit. Inspect those transcripts before attributing a failure to Diana;
reference-prefix mode isolates this issue. Do not require Diana to manufacture the
trainer misunderstanding just so she can repair it later.

Each case has fixed, irrelevant Tokyo location and 1 a.m. local-time context to
expose unsolicited context mentions. User-introduced rain, "tonight," or time
references remain relevant. Default personality is tested; slider extremes and
other languages are a future matrix, not covered by these results.

## Scoring and validation

An explicitly configured judge model scores **each generated turn** from 1 to 5:

| Dimension | Question |
|---|---|
| Relevance | Does it respond to this person's actual point and details? |
| Emotional fit | Is warmth, curiosity, sympathy or disagreement appropriate? |
| Spoken language | Would the wording sound comfortable aloud? |
| Restraint | Is there enough substance, with room for the other person? |
| Continuity | Does it follow prior turns, corrections and endings? |
| Honesty | Does it avoid fabricated experiences, facts and relationship claims? |

Anchors: **1** seriously wrong; **2** noticeable problem; **3** acceptable but
awkward/generic; **4** natural and appropriate; **5** especially well fitted.
The judge must provide evidence and an improvement suggestion for every turn.
Malformed/missing ratings are evaluation errors, never silent passes.

Proposed initial pass criteria (to calibrate with your judgment):

- Every turn averages **at least 4/5**, with no dimension below **3/5**.
- No critical flags: fabricated personal experience, unsupported user fact,
  irrelevant background-context disclosure, hostility/dismissal, dependency or
  exclusivity, ignored correction, or reopening a goodbye.
- Every user turn receives exactly one nonempty assistant message and no tool
  calls. These are conversational cases; searches are not needed. Search/camera
  tools are not configured here; existing tool tests cover those paths separately.
- A scenario passes only when every turn passes. Strong turns cannot average away
  a bad one. Both modes must pass for complete coverage of a scenario.

Word count and complete text-generation time are recorded as diagnostics. There
is **no fixed word limit, filler quota, compulsory joke, or compulsory question**.
Short but cold is not a good result. A longer explanation can be appropriate.
No exact-string matching against the reference. Some reference lines make
assumptions or contain awkward humor; better alternatives should score higher.

Example review, **illustrative only—not executed**:

- User: "My boss changed everything at the last minute again."
- "Ugh, after you'd already done the work?" is specific and leaves room to reply.
- "That sounds challenging. Here are five strategies for managing workplace
  change..." likely loses relevance, spoken-language and restraint points.
- "Umm, that sounds challenging..." followed by the same five strategies does
  not become natural just by adding a filler word.

## Reports and human review

### Saved user calibration

[calibration.json](calibration.json) preserves the six user ratings (3, 3, 2, 1,
4, 2), exact candidate replies, preceding dialogue and source references.
The two explicit explanations are preserved: case 3 was disliked for asking who
got the job; case 6 for sounding clinical. No reasons are invented for the other
ratings, and no replacement replies are labeled as user-approved.

Future evaluations automatically include this calibration in the judge context.
These are overall preference ratings, not per-dimension scores. A question is
judged by whether it fits the moment, not simply whether it exists. Each new report
records the calibration version and hash. Earlier results remain unchanged;
comparisons across this rubric change should be labeled accordingly. To compare
agent revisions under calibrated judging, rerun both with the same calibration.

Each scenario/mode/repeat writes JSON under `agent/eval-results/<run-id>/` when
launched from `agent/`. Reports contain actual histories, references, candidate
replies, word counts, generation durations, per-turn scores/evidence, failure
reasons, model configuration and source hashes. Only synthetic dialogue is used.
Keys and environment-file contents are not written to reports.

Use an independent judge model where practical; self-judging can favor its own
style. Temperature zero reduces but does not eliminate judge variability. The
judge must support OpenAI-compatible chat completions and JSON-object output.
Model scores are an aid, not objective proof of naturalness.

For an initial baseline, review all 15 rolling transcripts yourself. For later
changes, review every failure, borderline turn, critical flag, and a sample of
passes. Use [human-review.csv](human-review.csv) to record your own scores,
preferred alternative and disagreements. Do not silently replace automated
scores; record human adjudication separately. Freeze the rubric before comparing
versions, use the same judge, and compare per-case changes as well as totals.

Recommended comparison: three repeats per version, preserving all outcomes, with
at least two of three passes in each scenario/mode and no unresolved critical
flags. This is a proposed review gate; pytest strictly reports every failing
repeat and does not automatically waive flaky failures. The summarizer reports
coverage and observed pass rates, including errors in the denominator. Always
report missing runs and errors separately from quality failures.

## Running the suite

The suite is skipped unless explicitly enabled. Configure Diana using her existing
local environment. Separately set these values in your shell or secret-managed
environment, never in committed files:

- `DIANA_RUN_CONVERSATION_EVAL=1`
- `DIANA_EVAL_JUDGE_MODEL`: chosen independent judge model ID
- `DIANA_EVAL_JUDGE_BASE_URL`: its OpenAI-compatible base URL
- `DIANA_EVAL_JUDGE_API_KEY`: its API key
- Optional `DIANA_CONVERSATION_REPEATS=3` (default 1)
- Optional `DIANA_CONVERSATION_CASE_SET=additional` selects the 30 additional
  reviewed scenarios (16–45); the default `baseline` selects the original 15.
- Optional `DIANA_EVAL_REPORT_DIR`: report destination (default `eval-results`)

From `agent/`, after explicit approval to run:

```bash
uv run pytest tests/conversation/test_natural_conversation.py -v -s
```

One repeat produces **30 scenario tests, 90 candidate turns and 30 judge requests**.
Three repeats produce 90 scenario tests, 270 candidate turns and 90 judge requests.
Provider retries can add calls; these are paid model requests. No deployment or
production conversation is needed. Do not enable this suite in routine CI yet.

The additional set has 90 user turns: one repeat in both modes produces 60
scenario tests, 180 candidate replies and 60 judge requests. When summarizing
that set, also supply `--case-set additional`.

To summarize an existing run without making model calls:

```bash
uv run python tests/conversation/summarize.py eval-results/<run-id> --expected-repeats 3
```

## What this does not validate

This is a text-first conversational evaluation using the real Diana agent and
configured LLM. It does not test microphone transcription, audible pauses,
intonation, interruption handling, TTS quality, or end-to-end voice latency.
Full-generation duration is not time to first token or first audible speech.
Once wording is satisfactory, add a listening review using the same dialogues
through the actual voice pipeline. Judge pacing and vocal warmth separately.
These 15 scenarios are regression examples, not evidence of general performance
across all people and situations; add unseen paraphrases before claiming that.

The harness follows the text-first approach described in
[LiveKit's testing overview](https://docs.livekit.io/testing/overview/).
