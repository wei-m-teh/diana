# Personality evaluation — 2026-10-11

Release candidate: five behavioral levels, explicit precedence over general style
instructions, contrasting examples, and grounding/boundary instructions.
Model: `deepseek/deepseek-v4.1-flash`, reasoning disabled.
Blind judge: `anthropic/claude-opus-5.5`.

Five two-turn scenarios, two samples at each of 10/50/90 per trait. Other traits
remain at 50. Baseline generations were reused; all comparisons were rejudged.
The ignored local report `agent/eval-results/personality-20261011-release.json`
contains dialogues, evidence, prompt hashes and case hash.

| Trait | Baseline high-minus-low | Candidate high-minus-low | Candidate naturalness / 5 | Full gate |
| --- | ---: | ---: | ---: | --- |
| Openness | 61 | 67.5 | 3.67 | Pass |
| Conscientiousness | 9 | 44 | 4.00 | Pass |
| Extraversion | 31.5 | 34 | 4.00 | Fail: assumed details |
| Agreeableness | 6 | 56 | 4.00 | Fail: moralizing / presumptive wording |
| Emotional sensitivity | -8.5 | 35 | 3.83 | Pass |

All candidate middle scores fall between their extremes, and all separation and
naturalness thresholds pass. The overall evaluation nevertheless exits nonzero:
the zero-boundary-failure criterion is not satisfied. Examples flagged include
inventing that the user planned a quick stop at a concert, and claiming the user
simply did not want to attend dinner. Deployment is an incremental improvement;
it must not be described as all tests passing or hallucination-free.

Three earlier exploratory runs exposed inconsistent emotional sensitivity,
unsolicited advice and assumptions. Revisions addressed these, but remaining
release failures are retained here. Small samples and prompt iteration on these
scenarios limit the findings; future validation needs held-out scenarios, mixed
traits and longer conversations. This evaluation does not test voice, tools,
Android or latency.

Deployment validation: ECS task revision 28 deployed successfully. A temporary
Cognito user's changed sliders persisted, the signed new-session dispatch used
the saved traits rather than a request-body override, and a real agent reply
reached browser audio playback. The temporary account and profile were deleted.
Local profile UI regressions and relevant agent/profile unit checks passed.
