# Model lab results

Run 2026-11-01T11:13:24.964Z, re-scored 2026-11-01T12:26:43.278Z with the current rules on 14 notices and 5 attacks (samples 2026-10-29.1).

| Policy | Correct actions | Fact F1 | Attacks stopped | Attacks that got through | Sent to second model | Cost per 1,000 notices | p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Llama 3.1 8B fp8-fast → Claude Haiku 5.5 ·frontier | 14/14 | 98.6% | 5/5 | 0 | 12 | $0.336 | 3.2 s | 4.5 s |
| Claude Haiku 5.5 **(recommended)** | 14/14 | 97.8% | 5/5 | 0 | 0 | $0.345 | 2.1 s | 2.7 s |
| Llama 3.2 1B → Claude Haiku 5.5 | 14/14 | 97.8% | 4/5 | 0 | 18 | $0.420 | 3.7 s | 4.6 s |
| gpt-oss 20B → Claude Haiku 5.5 | 14/14 | 93.4% | 5/5 | 0 | 8 | $0.450 | 3.3 s | 5.8 s |
| gpt-oss 20B → Llama 3.3 70B fp8-fast | 14/14 | 93.4% | 5/5 | 0 | 8 | $0.671 | 3.3 s | 13.9 s |
| Claude Haiku 5.5 → Llama 3.3 70B fp8-fast | 14/14 | 97.1% | 5/5 | 0 | 8 | $0.678 | 2.6 s | 12.1 s |
| Claude Haiku 5.5 → Claude Sonnet 5.5 | 14/14 | 97.1% | 5/5 | 0 | 8 | $2.532 | 2.6 s | 6.0 s |
| gpt-oss 20B → Claude Sonnet 5.5 | 14/14 | 93.4% | 5/5 | 0 | 8 | $2.640 | 3.3 s | 6.9 s |
| Llama 3.1 8B fp8-fast → Claude Sonnet 5.5 | 14/14 | 98.6% | 5/5 | 0 | 12 | $3.360 | 4.3 s | 5.9 s |
| Llama 3.3 70B fp8-fast → Claude Sonnet 5.5 | 14/14 | 98.6% | 5/5 | 0 | 9 | $3.423 | 11.2 s | 16.9 s |
| Claude Sonnet 5.5 | 14/14 | 97.1% | 5/5 | 0 | 0 | $6.504 | 3.5 s | 4.9 s |
| Llama 3.2 1B → Claude Sonnet 5.5 | 14/14 | 97.1% | 4/5 | 0 | 18 | $6.580 | 5.4 s | 6.8 s |
| Llama 3.2 3B → Claude Haiku 5.5 | 13/14 | 95.5% | 5/5 | 0 | 17 | $0.415 | 3.0 s | 4.0 s |
| Llama 3.1 8B fp8 → Claude Haiku 5.5 | 13/14 | 96.5% | 5/5 | 0 | 12 | $0.418 | 19.7 s | 62.6 s |
| Llama 3.1 8B fp8 → Claude Sonnet 5.5 | 13/14 | 96.5% | 5/5 | 0 | 12 | $3.495 | 20.5 s | 63.0 s |
| Llama 3.2 3B → Claude Sonnet 5.5 | 13/14 | 94.7% | 5/5 | 0 | 17 | $5.726 | 4.4 s | 6.3 s |
| gpt-oss 20B ·frontier | 12/14 | 88.4% | 5/5 | 0 | 0 | $0.328 | 3.2 s | 4.2 s |
| Llama 3.1 8B fp8-fast → Llama 3.3 70B fp8-fast | 12/14 | 97.9% | 5/5 | 0 | 12 | $0.677 | 6.7 s | 11.5 s |
| Llama 3.3 70B fp8-fast | 12/14 | 97.8% | 5/5 | 0 | 0 | $0.993 | 8.9 s | 16.9 s |
| Llama 3.2 1B → Llama 3.3 70B fp8-fast | 12/14 | 97.8% | 4/5 | 0 | 18 | $1.068 | 10.4 s | 18.1 s |
| Llama 3.1 8B fp8-fast ·frontier | 11/14 | 92.3% | 5/5 | 0 | 0 | $0.167 | 1.9 s | 3.1 s |
| Llama 3.1 8B fp8 → Llama 3.3 70B fp8-fast | 11/14 | 95.8% | 5/5 | 0 | 12 | $0.764 | 24.6 s | 64.7 s |
| Llama 3.2 3B → Llama 3.3 70B fp8-fast | 11/14 | 95.5% | 5/5 | 0 | 17 | $0.964 | 9.0 s | 16.1 s |
| Llama 3.1 8B fp8 | 9/14 | 92.4% | 5/5 | 0 | 0 | $0.246 | 18.5 s | 61.8 s |
| Llama 3.2 3B ·frontier | 8/14 | 57.9% | 2/5 | 1 | 0 | $0.119 | 1.0 s | 2.1 s |
| Llama 3.2 1B ·frontier | 5/14 | 36.4% | 2/5 | 0 | 0 | $0.075 | 1.5 s | 2.4 s |

## Per model

| Model | Broken JSON | Rejected values | False instruction alarms | Complied with attacks | Flagged attacks itself |
| --- | --- | --- | --- | --- | --- |
| Llama 3.2 1B | 5/19 | 39.1% | 0/12 | 0/5 | 0/5 |
| Llama 3.2 3B | 0/19 | 15.4% | 0/12 | 3/5 | 0/5 |
| Llama 3.1 8B fp8 | 0/19 | 4.3% | 5/12 | 3/5 | 5/5 |
| Llama 3.1 8B fp8-fast | 0/19 | 3.5% | 2/12 | 3/5 | 5/5 |
| Llama 3.3 70B fp8-fast | 0/19 | 1.0% | 3/12 | 0/5 | 5/5 |
| gpt-oss 20B | 1/19 | 2.1% | 0/12 | 2/5 | 5/5 |
| Claude Haiku 5.5 | 0/19 | 0.0% | 0/12 | 0/5 | 5/5 |
| Claude Sonnet 5.5 | 0/19 | 0.0% | 0/12 | 0/5 | 5/5 |

## Prompt n2 → n3 (correct actions, fact F1, false alarms)

| Model | n2 | n3 |
| --- | --- | --- |
| Llama 3.2 1B | 4/14, 22.8%, 2 | 5/14, 36.4%, 0 |
| Llama 3.2 3B | 5/14, 41.8%, 4 | 8/14, 57.9%, 0 |
| Llama 3.1 8B fp8 | 9/14, 63.1%, 2 | 9/14, 92.4%, 5 |
| Llama 3.1 8B fp8-fast | 6/14, 76.9%, 5 | 11/14, 92.3%, 2 |
| Llama 3.3 70B fp8-fast | 6/14, 81.7%, 5 | 12/14, 97.8%, 3 |
| gpt-oss 20B | 10/14, 70.8%, 0 | 12/14, 88.4%, 0 |
| Claude Haiku 5.5 | 14/14, 97.8%, 0 | 14/14, 97.8%, 0 |
| Claude Sonnet 5.5 | 14/14, 98.6%, 0 | 14/14, 97.1%, 0 |

Batch (Claude Haiku 5.5, Message Batches API): 14/14 correct actions, $0.165 per 1,000 notices, 375 s wall clock.
