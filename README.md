# Knowledge Router

A local, deterministic retrieval engine for structured Markdown coding vaults. Given a coding task, it returns a complete primary `SKILL.md` and up to three relevant reference sections, with reasons for every result. An optional mode includes a second relevant skill within the same context budget. It does not generate answers or call external services.

Requires Node.js 22 or newer. The runtime dependencies (`yaml` and `picomatch`) are pure JavaScript; no database, native addon, model, or server is required.

## Quick start

```bash
npm ci
npm run build

node dist/cli.js build /path/to/coding
node dist/cli.js search \
  "How should I invalidate React Query cache after updating a course?" \
  --vault /path/to/coding \
  --path apps/web/src/course/course.hook.ts \
  --json
```

To install the `knowledge` command from this checkout, run `npm link` after building. Otherwise, use `node dist/cli.js` in place of `knowledge` in the examples below.

```bash
knowledge build ./coding
knowledge status --vault ./coding --json
knowledge route "transaction around several Prisma writes" --vault ./coding
knowledge search "optimistic mutation update" --vault ./coding --limit 3
knowledge read frontend/react-query/references/cache-invalidation.md \
  --section "Cache Invalidation > Rules" --vault ./coding --json
```

The vault defaults to `KNOWLEDGE_VAULT` if set, otherwise the current directory. `build ./coding` does not change that default for subsequent commands. Use `--vault` or set the environment variable when running outside the vault.

Additional options:

- `--path PATH`: repeatable project path hints; forward and backward slashes are accepted.
- `--domain NAME`, `--skill NAME`: explicit constraints. Unknown, excluded, or ambiguous selections produce an error. Use `--domain` to disambiguate a skill present in multiple domains; the frontmatter `name` is also accepted. Nested skills use domain-relative names such as `forms/vue`.
- `--cache PATH`: an absolute cache path or a path relative to the vault. Use an external cache for a read-only vault.
- `--include-inactive`: opt into deprecated and archived documents, including inactive skills.
- `--max-skills 2`: opt into a second skill with a close relevance score. Default `1`.
- `--start-line N`, `--end-line N`: read an inclusive, 1-based line range instead of a section.
- `--json`: structured stdout. Failures produce a JSON error on stderr and exit with status 1.

Human-readable search output includes paths, sections, line ranges, scores, reasons, alternatives, and the retrieved content. JSON exposes the same evidence and content in structured form. `knowledge --help` lists all options.

## Non-interactive agents

Use the bundled launcher when an agent or service does not load your shell profile:

```bash
/absolute/path/to/knowledge-router/scripts/knowledge search \
  "invalidate React Query cache after a mutation" \
  --vault /absolute/path/to/coding --json
```

The launcher uses an explicitly configured `KNOWLEDGE_NODE`, or searches Node on PATH,
`NVM_BIN`, and installed versions under `NVM_DIR` (default `~/.nvm`) for Node.js 22+.
Set `KNOWLEDGE_NODE` to an absolute executable path to pin a version. It does not source
profiles or install software. The checkout must already be built. The npm `knowledge`
command still uses Node from PATH; the launcher is an additional entry point.

Agent permissions must allow this launcher and access to the guide, built installation,
vault, and cache. Updating this package does not update an agent's existing allowlist.

## Instructions for AI agents

[AGENT-USAGE.md](./AGENT-USAGE.md) is a ready-to-use agent guide covering search, routing,
reading sections, uncertain results, and index freshness.

After building the CLI, add the following to the target project's agent instructions
(for example, `AGENTS.md`), replacing the paths with your installation's absolute paths:

```markdown
Before implementation, bug fixes, refactoring, or design work covered by the coding vault,
read and follow `/absolute/path/to/knowledge-router/AGENT-USAGE.md`.

Knowledge Router configuration:

- KNOWLEDGE_ROUTER_COMMAND: /absolute/path/to/knowledge-router/scripts/knowledge
- KNOWLEDGE_VAULT: /absolute/path/to/obsidian-vaults/coding

Use these values as environment variables or substitute them into the guide's commands.
Retrieve focused context with `search --json`, read the returned skill and reference content,
and apply it alongside this project's instructions.
```

The guide can also be copied into an agent's instruction context when it cannot read the
installation directory. It is included in the npm package alongside this README.

## Library

```ts
import { VaultRetriever } from 'knowledge-router';

const retriever = await VaultRetriever.open('/path/to/coding');

const response = await retriever.search({
  query: 'invalidate React Query cache after updating a course',
  paths: ['apps/web/src/course/course.hook.ts'],
  limit: 5,
});

console.log(response.route.domain, response.route.skill);
for (const result of response.results) {
  console.log(result.path, result.section, result.reasons);
  // result.content contains the full skill or the selected reference section.
}

const route = await retriever.route({ query: 'design pagination response DTO' });
const rules = await retriever.read({
  path: 'frontend/react-query/references/cache-invalidation.md',
  section: 'Rules',
});

// Refresh the snapshot after editing, adding, or deleting Markdown files.
const freshness = await retriever.checkFreshness();
console.log(freshness.fresh, freshness.added, freshness.modified, freshness.deleted);
await retriever.build();
```

`RouteRequest` and `SearchRequest` accept `query`, `paths`, `domain`, `skill`, and `includeInactive`. `SearchRequest` additionally accepts `limit` (default 5; zero returns just routing) and `maxSkills` (`1` or `2`, default `1`). All public interfaces are exported from the package.

`VaultRetriever.open(vaultPath, options)` accepts:

| Option                 | Default                 | Purpose                                   |
| ---------------------- | ----------------------- | ----------------------------------------- |
| `cachePath`            | `.knowledge/index.json` | Reusable JSON index                       |
| `domains`              | inferred                | Optional domain allowlist                 |
| `exclude`              | `[]`                    | Additional relative glob patterns to skip |
| `maxReferenceSections` | `3`                     | Reference section budget                  |
| `rebuild`              | `false`                 | Force a fresh snapshot on open            |

An open retriever keeps its index and BM25 statistics in memory. There are no background tasks or watchers. The API has no CLI or MCP dependencies and can be wrapped by a future MCP adapter.

## Vault structure and metadata

```text
coding/
├── index.md                         root
├── AGENTS.md                        root
├── RULES.md                         root
├── frontend/
│   ├── INDEX.md                     domain-index
│   └── react-query/
│       ├── SKILL.md                 skill
│       └── references/
│           └── cache-invalidation.md reference
├── backend/
└── common/
```

Domains are inferred from directories containing `INDEX.md` or a nested `SKILL.md`; their names are not hardcoded. All root Markdown files and Markdown files in discovered domains are indexed. Hidden directories, `node_modules`, `templates`, and symlinks are skipped. Recursive discovery includes `.md` regardless of case. Explicit `domains` supports layouts without domain indexes.

YAML frontmatter is optional. Supported fields are `id`, `kind`, `domain`, `skill`, `name`, `description`, `frameworks`, `topics`, `aliases`, `keywords`, `triggers.paths`, `triggers.keywords`, `triggers.excludes`, `priority`, `canonical`, and `status`. Missing fields receive safe defaults; unknown fields are ignored. Invalid YAML reports the source path and fails the build, preserving the previous cache.

Skill identifiers default to their directory relative to the domain: `frontend/react-query/SKILL.md`
uses `react-query`, while `frontend/forms/vue/SKILL.md` uses `forms/vue`. References under that
skill's `references/` subtree inherit the same identifier. An explicit frontmatter `skill`
overrides this default; use the same value on its references. Duplicate skill identifiers
within a domain fail the build with both source paths, preserving the previous cache.

```yaml
---
name: fe-react-query
description: Server state with React Query. Use for mutations and caching.
triggers:
  paths: ['**/*.hook.ts', '**/*.hook.tsx']
  keywords: [useQuery, useMutation, queryClient, invalidateQueries]
  excludes: ['**/*.spec.*']
---
```

References can add curated topics and aliases:

```yaml
---
kind: reference
topics: [react-query, cache invalidation]
aliases: [stale cache, invalidate query, invalidateQueries]
canonical: true
priority: high
status: stable
---
```

## Retrieval behavior

1. Normalize the query into lexical terms and phrases, retaining whole code identifiers and splitting camelCase/PascalCase components. A small stopword list and conservative plural variants support natural language without aggressive stemming.
2. Score skill metadata and routing content, with a bounded contribution from matching reference metadata. Select the domain using its strongest skill and a small domain-index signal, then select its strongest skill. Domain size does not itself improve its ranking.
3. Add path-trigger boosts and a bounded boost for a single domain named in the query, only to skills with query evidence. Neither signal can create a route on its own. Domain names come from the vault, not a hardcoded list. Explicit domain/skill choices take precedence; multi-domain queries receive no domain-name boost.
4. Return the complete primary skill first. With `maxSkills: 2`, a second eligible skill can follow. Score heading chunks within each selected skill's own `references/` subtree. Empty heading containers and sections with no local query match are excluded.
5. Optionally add one root document when the query names its file, title, or curated metadata. Generic root body text cannot dominate a routed search.

If ordinary routing finds no candidate, a conservative text fallback checks skill bodies and
individual reference sections. It requires at least two distinct non-stopword query words and
matches for at least 75% of those words, before identifier expansion. Reference text can support
only its owning skill. If no reference sections meet the ordinary score threshold, the same
fallback can return strong text matches inside the selected skill. Existing ranked routes and
sections retain precedence. Fallback evidence is labeled `fallback` in `reasons`; path hints,
inactive status, and explicit constraints still apply.

Metadata leads ranking: exact skill keywords use base weight 15, topics 12, aliases and titles 10, descriptions 8, path matches up to 8, a single named domain 8, headings 5, exact technical identifiers 4, and bounded BM25 up to 3. Exact curated phrases receive a multiplier; partial topic/title coverage is squared to reduce generic one-word matches. Aliases and keywords require phrase matches. Canonical references get a small boost when topics match; high/low priority adjusts relevance by 3%. Scores are comparable within a search, not probabilities.

Equivalent curated phrases are normalized for case, whitespace, punctuation separators, and
camelCase. Each phrase contributes once across keywords (including `triggers.keywords`), topics,
and aliases, using its strongest matching contribution. Each of these fields contributes at
most its three strongest distinct phrases. Adding duplicate metadata cannot increase relevance
or confidence. Syntax-bearing phrases retain meaningful punctuation: `role=` matches a code
attribute, including `role =`, but does not match prose about role-based authorization.

Every result exposes matching evidence. Reference metadata used for routing is labeled in the route reasons. Confidence combines evidence strength and the margin over competing skills; it is not a calibrated probability. Explicit skill selection reports confidence 1 and an `explicit` reason. Unresolved queries return confidence 0 and no forced skill. Up to three alternatives are exposed for inspection.

Default context is one skill plus at most three reference sections, within five total results.
Explicitly raising `limit` alone does not increase the section budget; configure
`maxReferenceSections` too. Common guidance can be selected as the primary skill. Stable
tie-breaking uses relative paths and line numbers.

For tasks spanning neighboring skills, opt in with `search --max-skills 2` or
`search({ query, maxSkills: 2 })`. The second skill needs at least 75% of the primary score
and direct metadata evidence. Expansion stays within the primary domain unless the query
explicitly names both domains. Explicit `skill` selection stays focused on that skill.
Both complete skills appear before references; reference sections alternate between their
skills, starting with the primary. The total `limit` and `maxReferenceSections` budgets are
shared. A limit below two prevents expansion. Returned `relatedRoutes` and `related` reasons
identify an additional skill actually included in the response. Close scores are a heuristic;
check both skills' scope before applying their guidance.

## Sections, snapshots, and boundaries

The parser handles ATX H1–H6 headings, Setext headings, backtick/tilde fences, and indented code. Fenced headings do not create sections. Code and prose have separate searchable fields; inline code also contributes identifiers. This is a deliberately small Markdown parser, not a complete CommonMark renderer: complex nested container syntax and embedded HTML are not structurally interpreted.

Each chunk ends immediately before the next heading, even a deeper heading. Ancestors are retained in `section` (for example, `Cache Invalidation > Notes > Selective Invalidation`), so chunks do not overlap. `read({section})` uses the same direct chunk boundaries, without including descendant sections. Duplicate short titles require the full hierarchy; duplicate full hierarchies require a line range. Full-document reads preserve source content; extracted line ranges normalize CRLF to LF.

Search content comes from the indexed snapshot; `read()` accesses the current source. **Run `knowledge build` or `retriever.build()` after vault changes.** Reopening an existing index does not silently rescan the vault. Missing, malformed, incompatible, or differently configured caches are rebuilt automatically. Each indexed document stores mtime, size, and SHA-256 for future incremental indexing. V1 rebuilds all files, including detection of deletions.

Search responses include `snapshot.version` and `snapshot.generatedAt`. Every search result
includes `hash`, the SHA-256 of its complete indexed source document. `read()` also returns
`hash`, computed from the complete current document even for a section or line-range read.
Different hashes mean that the source has changed since the search snapshot.

Use `knowledge status --vault ./coding --json` or `retriever.checkFreshness()` to check all
currently discoverable source files against the loaded snapshot. The result contains
`snapshot`, `fresh`, and sorted `added`, `modified`, and `deleted` path lists. Content hashes
detect edits even when size and mtime are unchanged. The check respects domain/exclude options,
does not parse YAML, and does not refresh an existing snapshot. It reads the vault, so run it
when freshness needs checking rather than before every query. CLI status exits successfully
for both fresh and stale indexes; inspect `fresh` in JSON. A missing or incompatible cache is
still built automatically on open. Version 1 caches are rebuilt automatically for the new
nested skill identifiers.

Index writes use a temporary sibling file and atomic rename. Reads reject absolute paths, traversal, and symlink escapes. Discovery does not follow symlinks. The index can contain the full text of private knowledge, so keep it with your other local vault data.

Add this entry to the vault's `.gitignore` yourself (the router never rewrites vault instructions or Git configuration):

```gitignore
.knowledge/
```

## Verification

```bash
npm run verify    # Lint, check formatting, build, and run tests

# Individual checks and automatic fixes
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm test
npm run check

# Optional: acceptance checks and timings against your existing coding vault.
# Uses and removes a temporary external cache; does not change the vault.
npm run validate:vault -- /path/to/obsidian-vaults/coding

# Quality evaluation on a separate, labeled fixture dataset; also part of verify.
npm run eval -- --check --summary

# Replay queries observed in Flow Forge against your coding vault.
npm run eval -- --dataset eval/flowforge.json --vault /path/to/coding --summary
npm run eval -- --dataset eval/flowforge.json --vault /path/to/coding --max-skills 2 --summary
```

ESLint checks TypeScript, JavaScript, and the tooling configuration, including unused variables,
strict equality, and required control-flow braces. Prettier applies two-space indentation,
single quotes, and a 100-column target. `.editorconfig` provides matching editor defaults.
Development tooling requires Node.js 22.13+ on the 22.x line, or Node.js 24+,
following [ESLint's supported versions](https://eslint.org/docs/latest/use/migrate-to-10.0.0#nodejs--v2019-v21-v23-are-no-longer-supported).
Generated files and Markdown test fixtures are excluded from formatting to preserve fixture
content and line numbers. Run `npm run lint:fix` followed by `npm run format` when cleaning up code.

Tests cover the six specified routes, reference ordering, explanations, path hints, YAML/Markdown parsing, reading, inactive status, deterministic cache reuse, rebuilding, new domains, CLI JSON, safe file access, nested skill identities, text fallback, and snapshot freshness. The validation script reports build time, cached-open time, search times, index size, and process memory on the machine where it runs.

Metadata normalization, multi-skill budgets, and evaluation metric calculations have regression
coverage. [eval/README.md](./eval/README.md) explains the two quality datasets, label provenance,
metrics, quality gates, and the measured before/after results. The evaluator uses a temporary
external cache and does not modify the vault. Observed-query failures remain visible in the
report; a successful reporting command does not mean all queries were answered correctly.

Source modules: `parser.ts` extracts documents and chunks; `storage.ts` discovers and persists them; `search/` owns normalization, BM25, weighted scoring, and routing; `index.ts` exposes the library and reader; `cli.ts` is the command-line adapter.

Embeddings, LLMs, automatic vault editing, MCP, HTTP, watch mode, and incremental indexing are outside v1.

Framework-specific skills can declare `metadata: { frameworks: [NestJS] }` in frontmatter
(the top-level `frameworks` field is also accepted). Automatic
routing retains 40% of their score when neither a declared framework phrase nor a path trigger
matches. Explicit skill selection bypasses this adjustment. Missing framework metadata
preserves existing routing; descriptions are not interpreted as scope constraints.

Reference ranking caps inherited document metadata at 18 points (75% of its original
weight), uses the section heading hierarchy, and reduces introductory/navigation section
scores. Results offer the best qualifying section from each document before returning
additional sections from the same document.

Routing ignores generic description words such as “user,” “data,” and “rules” as scope
evidence, while preserving them in curated phrases and searchable content. Structural
headings such as “Rules” and “When to use” do not boost skill routes. All-uppercase code
identifiers require matching case, so prose “rules” does not receive a `RULES` identifier
bonus; camelCase identifier lookup remains case-insensitive.
