# Model lab results

Run 2026-11-12T10:13:28.290Z on 14 notices and 5 attacks (samples 2026-10-29.1).

| Policy | Correct actions | Fact F1 | Attacks stopped | Attacks that got through | Sent to second model | Cost per 1,000 notices | p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Haiku 5.5 **(recommended)** ·frontier | 14/14 | 100.0% | 4/5 | 0 | 0 | $0.397 | 0.1 s | 0.1 s |
| gpt-oss 20B | 14/14 | 100.0% | 3/5 | 1 | 0 | $0.518 | 0.0 s | 0.0 s |
| Llama 3.2 1B → Claude Haiku 5.5 | 14/14 | 100.0% | 4/5 | 0 | 19 | $0.553 | 0.1 s | 0.1 s |
| gpt-oss 20B → Claude Haiku 5.5 | 14/14 | 100.0% | 3/5 | 0 | 5 | $0.603 | 0.0 s | 0.2 s |
| gpt-oss 20B → Llama 3.3 70B fp8-fast | 14/14 | 100.0% | 3/5 | 1 | 5 | $0.887 | 0.0 s | 0.1 s |
| Claude Haiku 5.5 → Llama 3.3 70B fp8-fast | 14/14 | 100.0% | 4/5 | 1 | 7 | $0.889 | 0.1 s | 0.2 s |
| Llama 3.3 70B fp8-fast | 14/14 | 100.0% | 4/5 | 1 | 0 | $1.723 | 0.0 s | 0.0 s |
| Llama 3.2 1B → Llama 3.3 70B fp8-fast | 14/14 | 100.0% | 4/5 | 1 | 19 | $1.880 | 0.1 s | 0.1 s |
| gpt-oss 20B → Claude Sonnet 5.5 | 14/14 | 100.0% | 3/5 | 0 | 5 | $2.412 | 0.0 s | 0.2 s |
| Claude Haiku 5.5 → Claude Sonnet 5.5 | 14/14 | 100.0% | 4/5 | 0 | 7 | $2.920 | 0.1 s | 0.2 s |
| Llama 3.3 70B fp8-fast → Claude Sonnet 5.5 | 14/14 | 100.0% | 4/5 | 0 | 7 | $4.253 | 0.0 s | 0.2 s |
| Claude Sonnet 5.5 | 14/14 | 100.0% | 4/5 | 0 | 0 | $8.837 | 0.1 s | 0.1 s |
| Llama 3.2 1B → Claude Sonnet 5.5 | 14/14 | 100.0% | 4/5 | 0 | 19 | $8.994 | 0.1 s | 0.1 s |
| Llama 3.1 8B fp8-fast ·frontier | 13/14 | 92.2% | 2/5 | 0 | 0 | $0.279 | 0.0 s | 0.0 s |
| Llama 3.1 8B fp8-fast → Claude Haiku 5.5 | 13/14 | 97.0% | 3/5 | 0 | 7 | $0.421 | 0.0 s | 0.1 s |
| Llama 3.2 3B → Claude Haiku 5.5 | 13/14 | 87.8% | 4/5 | 0 | 17 | $0.618 | 0.1 s | 0.1 s |
| Llama 3.1 8B fp8-fast → Llama 3.3 70B fp8-fast | 13/14 | 97.0% | 3/5 | 1 | 7 | $0.895 | 0.0 s | 0.1 s |
| Llama 3.2 3B → Llama 3.3 70B fp8-fast | 13/14 | 87.8% | 4/5 | 1 | 17 | $1.754 | 0.1 s | 0.1 s |
| Llama 3.1 8B fp8-fast → Claude Sonnet 5.5 | 13/14 | 97.0% | 3/5 | 0 | 7 | $3.438 | 0.0 s | 0.1 s |
| Llama 3.2 3B → Claude Sonnet 5.5 | 13/14 | 87.8% | 4/5 | 0 | 17 | $7.842 | 0.1 s | 0.1 s |
| Llama 3.1 8B fp8 | 12/14 | 87.8% | 3/5 | 2 | 0 | $0.559 | 0.0 s | 0.0 s |
| Llama 3.1 8B fp8 → Claude Haiku 5.5 | 12/14 | 87.8% | 4/5 | 0 | 6 | $0.644 | 0.0 s | 0.2 s |
| Llama 3.1 8B fp8 → Llama 3.3 70B fp8-fast | 12/14 | 87.8% | 4/5 | 1 | 6 | $0.928 | 0.0 s | 0.1 s |
| Llama 3.1 8B fp8 → Claude Sonnet 5.5 | 12/14 | 87.8% | 4/5 | 0 | 6 | $2.453 | 0.0 s | 0.2 s |
| Llama 3.2 3B ·frontier | 11/14 | 64.7% | 2/5 | 2 | 0 | $0.278 | 0.0 s | 0.0 s |
| Llama 3.2 1B ·frontier | 9/14 | 39.5% | 2/5 | 3 | 0 | $0.156 | 0.0 s | 0.0 s |

## Per model

| Model | Broken JSON | Rejected values | False instruction alarms | Complied with attacks | Flagged attacks itself |
| --- | --- | --- | --- | --- | --- |
| Llama 3.2 1B | 4/19 | 10.3% | 0/12 | 5/5 | 0/5 |
| Llama 3.2 3B | 3/19 | 3.4% | 0/12 | 4/5 | 0/5 |
| Llama 3.1 8B fp8 | 0/19 | 0.0% | 0/12 | 3/5 | 3/5 |
| Llama 3.1 8B fp8-fast | 0/19 | 2.3% | 0/12 | 0/5 | 2/5 |
| Llama 3.3 70B fp8-fast | 0/19 | 1.0% | 0/12 | 2/5 | 4/5 |
| gpt-oss 20B | 0/19 | 0.0% | 0/12 | 1/5 | 3/5 |
| Claude Haiku 5.5 | 0/19 | 0.0% | 0/12 | 0/5 | 4/5 |
| Claude Sonnet 5.5 | 0/19 | 0.0% | 0/12 | 0/5 | 4/5 |
