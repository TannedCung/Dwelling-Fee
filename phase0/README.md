# Phase 0 — Extraction & Resolution Spike

Per `docs/design.md` §0 and §11: the riskiest part of this product is turning messy,
multilingual broker shorthand into correct structured facts. **Prove that works before
building infrastructure around it.** This harness is the gate.

## What's here

| File | Purpose |
|---|---|
| `schema.ts` | Extraction target (zod + the JSON tool schema handed to Claude). Mirrors `price_observation`. |
| `extract.ts` | Calls Claude Haiku with a forced tool to return structured output. Prompt-cached system prompt. |
| `dataset.ts` | Golden eval set: synthetic VI/EN broker messages + hand-labeled expected extractions. |
| `eval.ts` | Runs extraction over the set, aligns predicted↔expected, reports per-field accuracy + precision/recall. |

## Run

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...

npm run phase0:eval                       # score the whole golden set
npm run phase0:extract -- "Bán căn 2PN 60m2 giá 3.2 tỷ Q9"   # one-off
```

## How to read the output

- **Field accuracy** — per-field correctness over matched properties. `priceVnd`, `priceBasis`,
  and `dealStatus` are the high-stakes ones (they feed analytics and must not silently mix).
- **Property detection** — precision/recall on *how many* properties were found.
  - `spurious (hallucinated)` > 0 → the model is inventing properties. Bad; tighten the prompt.
  - `missed` > 0 → it's dropping properties from multi-property messages.

## The real work (not done yet)

1. **Replace synthetic data with ~100 real messages.** Synthetic data flatters the model.
2. **Label them** (this is the expensive, valuable part).
3. Iterate on the prompt in `extract.ts` until field accuracy + detection clear a bar you're
   comfortable building on (suggest: priceVnd & priceBasis ≥ 95%, no hallucinated properties).
4. Only then prototype **entity resolution** (docs/design.md §5) on the resolved properties.

Scoring tolerances: price within 0.5%, area within 0.5 m². `confidence` is not scored;
`name`/`locationText` are scored as a loose substring match.
