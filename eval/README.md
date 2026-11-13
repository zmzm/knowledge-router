# Retrieval quality evaluation

Two separate datasets exercise retrieval through `VaultRetriever.search()`:

- `fixtures.json`: 30 authored requests against the bundled fixture vault, including English
  paraphrases, Russian requests with technical identifiers, negative cases, and a mixed concern.
- `flowforge.json`: 29 distinct requests extracted from 28 command strings in the local Flow
  Forge run logs dated September 18–October 2, 2026. Only query text, relative path hints,
  explicit constraints, and source file/line provenance were retained. Raw logs, prompts,
  response contents, and session identifiers are not included.

The observed queries are real. Their expected routes and documents were labeled by the coding
agent after inspecting the current vault, independently of the recorded retrieval result.
The user has not reviewed these labels. Treat them as a reviewable baseline, not authoritative
ground truth. Product questions without corresponding knowledge are labeled as negatives;
generic coding advice does not supply missing course or enrollment policies. Where several
skills can reasonably lead, `expected.routes` lists acceptable primary routes.

## Run

```bash
npm run eval -- --check --summary
npm run eval -- --dataset eval/flowforge.json --vault /path/to/coding --summary
npm run eval -- --dataset eval/flowforge.json --vault /path/to/coding --max-skills 2 --summary
```

Omit `--summary` for per-case evidence, missing document paths, and metrics grouped by tag.
Use `--k N` to change the result budget, and `--confidence-threshold N` to change the audit
cutoff (default `0.5`). Confidence remains a heuristic, not a calibrated probability.

Each run builds a temporary external index, checks that labeled routes/documents exist in the
chosen vault, searches all cases, and removes the temporary cache. It never refreshes the
vault's normal cache. Invalid labels or unreadable source files fail the run rather than being
counted as retrieval misses. The observations are replayed against the current vault, not a
historical copy from the log date.

## Metrics

| Metric                                   | Definition                                                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routeAccuracy`                          | Fraction of all cases with an acceptable primary route, including correct abstentions.                                                                                                  |
| `positiveRouteAccuracy`                  | The same fraction on positive cases only.                                                                                                                                               |
| `abstentionAccuracy`                     | Fraction of negative cases returning no skill.                                                                                                                                          |
| `routeRecallAt3`                         | An acceptable route is among the primary and first two alternatives; negatives require abstention.                                                                                      |
| `documentRecallAtK`                      | Mean per-case fraction of labeled document paths found within the first K results. Repeated sections from one path count once. Cases without document labels are excluded.              |
| `confidentErrors` / `confidentErrorRate` | Incorrect primary routes above the confidence cutoff, counted and divided by all routes above that cutoff. Explicit skill choices are excluded because their confidence is forced to 1. |

Document labels identify required relevant documents, not an exhaustive list of all acceptable
context. Extra documents are therefore not counted as precision errors. Empty denominators
are reported as `null`. Selected related skills can improve document recall while the primary
route accuracy remains unchanged. This benchmark does not calibrate confidence or prove that
the retrieved guidance was applied correctly by an agent.

## Quality gates

`npm run verify` includes the fixture dataset's `--check` gate. Thresholds live in that dataset
and failures exit with status 1 while preserving the JSON report. Reporting mode exits with
status 0 even when individual retrieval cases fail. The observed dataset intentionally has
no gate yet; review its labels and residual misses before setting acceptance thresholds.

To add a case, give it a unique `id`, tags, a `request` accepted by `search`, and `expected` with
`routes` and `documents` arrays. Empty routes mean abstention is expected; otherwise any
listed route is an acceptable primary. Documents are relative vault paths. For external
datasets, supply `--vault`; a dataset's optional `vault` path is relative to its JSON file.
Keep observed queries unchanged and record provenance; distinguish authored paraphrases with
`source.kind: authored`. Do not relabel a miss just to match current engine output.

## Measured baseline

[reports/flowforge.json](./reports/flowforge.json) records the October 27, 2026 comparison on
the same 29 labels and current vault. It includes dataset/vault fingerprints and all remaining
route or document misses. The baseline was captured after priorities 1–3 and before metadata
normalization, syntax trigger fixes, and multi-skill expansion.

| Metric                         | Before | After, 1 skill | After, up to 2 skills |
| ------------------------------ | -----: | -------------: | --------------------: |
| Route accuracy                 |  69.0% |          72.4% |                 72.4% |
| Document recall at 5           |  44.7% |          47.4% |                 50.9% |
| Confident errors at cutoff 0.5 | 4 of 8 |         1 of 5 |                1 of 5 |

The fix for syntax-bearing triggers stops `role=` from routing backend authorization requests
to frontend accessibility. Two authorization requests now abstain and remain misses, while
the mixed NestJS/Prisma request routes to backend coding. Remaining issues include generic
terms forcing routes for product-only questions, low recall for some specific references,
and mixed tasks whose second relevant skill falls outside the expansion margin. Keep these
cases visible when changing weights or coverage.

## SnowRunner Companion report

`snowrunner.json` preserves the two exact searches supplied in the November 13, 2026
agent report. Labels are agent-proposed and not user-reviewed. Replay with:

```bash
npm run eval -- --dataset eval/snowrunner.json --vault /path/to/coding --k 4
```

The `automatic` and `explicit` tags separate discovery from forced skill selection.
Use `--k 4` to reproduce the reported budget; the evaluator's default is 5 and overrides
per-case limits. This dataset has no acceptance gate. Document recall does not measure
whether a returned section contains useful guidance; optional `expected.sections` labels measure exact `{path, section}` matches using the
full heading hierarchy. `sectionRecallAtK` averages recall over section-labeled cases;
unlabeled cases are excluded. Duplicate labels count once. Labels are validated against
current vault section reads before evaluation. Navigation in the same document does not
satisfy a substantive section label. Ranking regression tests also cover section selection.

## Latest five local runs

`latest-five.json` labels 11 technical requests from the 19 searches in the user-supplied
review. Requests preserve exact query text, constraints, limits and log provenance. Labels
are agent-proposed against existing guidance, not user-reviewed. Backend authorization and
URL-state cases also require substantive sections. Run with:

```bash
npm run eval -- --dataset eval/latest-five.json --vault /path/to/coding
```

Product-policy queries, the invalid domain, and forced frontend auth selection remain in
the unlabeled replay report. They are not assigned unsupported correctness labels. These
observations guided the metadata changes and therefore are regression cases, not an
independent generalization benchmark. The full replay retains all 19 searches.
