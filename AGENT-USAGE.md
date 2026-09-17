# Knowledge Router instructions for coding agents

Use Knowledge Router to retrieve curated coding guidance before implementing a feature,
fixing a bug, refactoring, or making a design decision covered by the configured vault.
It returns source documents and sections; you must read and apply the relevant guidance
yourself. Repository instructions and the user's requirements remain authoritative.

## Configuration

The project or user must supply:

- `KNOWLEDGE_VAULT`: the absolute path to the coding Markdown vault.
- `KNOWLEDGE_ROUTER_CLI`: the absolute path to this installation's built `dist/cli.js`.

These examples use shell environment variables. Make them available in each shell invocation,
or substitute the configured absolute paths. `KNOWLEDGE_ROUTER_CLI` is a convention in this
guide, not an environment variable read by the router itself.

```bash
export KNOWLEDGE_VAULT="/absolute/path/to/obsidian-vaults/coding"
export KNOWLEDGE_ROUTER_CLI="/absolute/path/to/knowledge-router/dist/cli.js"
```

If the `knowledge` command is installed, it can replace `node "$KNOWLEDGE_ROUTER_CLI"`.
Use the configured installation. Do not assume that an npm registry package or MCP tools
named `knowledge_search`, `knowledge_route`, or `knowledge_read` are available.

Keep your working directory in the project you are changing. Always pass `--vault` explicitly
as shown below; otherwise the command can index the working directory when the environment
variable is missing. The CLI requires a built installation; see the README's setup steps
if `dist/cli.js` does not exist.

## Default workflow

1. Read the project's applicable instructions and identify the task's main concern.
2. Write a concise retrieval query containing the operation, technology, and relevant code
   identifiers. For example: `invalidate React Query cache after useMutation updates a course`.
   Avoid vague queries such as `fix this` and avoid pasting an entire conversation or source file.
3. Search once with `--json`. Add a separate `--path` for each known affected project file.
   These paths are hints relative to the project, not paths to Markdown files in the vault.
4. Inspect `route.domain`, `route.skill`, `route.reasons`, and any `route.alternatives`.
   Confirm that the selected skill fits the task.
5. Read the complete primary skill's `content`, then the relevant reference results' `content`.
   Search JSON already includes the text: do not reread those files merely to obtain the same content.
6. Apply the guidance while inspecting and changing the project. Retrieve additional context
   only when a specific unanswered question or a different concern requires it.

```bash
node "$KNOWLEDGE_ROUTER_CLI" search \
  "invalidate React Query cache after useMutation updates a course" \
  --vault "$KNOWLEDGE_VAULT" \
  --path apps/web/src/course/course.hook.ts \
  --limit 5 \
  --json
```

Pass the query as one quoted argument. When invoking the CLI programmatically, use an argument
array instead of interpolating task text into a shell command.

The normal result is one complete `SKILL.md` and up to three reference sections. Each result
contains `path`, `kind`, `content`, `score`, `reasons`, and inclusive `startLine`/`endLine` values;
reference sections also have a `section` label. Paths are relative to the vault. Use these paths
and headings when identifying the guidance you applied.

## Decide whether the route is useful

Check the evidence and skill boundaries, not just the score. A `.hook.ts` path can match both
hook structure and React Query guidance. Use the task's actual concern to distinguish them.

Confidence is a relative heuristic, not a probability or a pass/fail threshold. Correct routes
can have modest confidence. An explicit `--skill` selection reports confidence `1` because you
selected it; that does not independently validate the choice.

If the route is unclear or a nearby alternative is equally plausible:

1. Refine the query with the missing operation or identifier, then search again.
2. If necessary, inspect the most plausible alternative with its returned domain and skill.
3. Compare the skills' scope and boundaries and retain only the relevant guidance.

For example, when the task is about a hook's return interface:

```bash
node "$KNOWLEDGE_ROUTER_CLI" search \
  "design a custom hook return interface" \
  --vault "$KNOWLEDGE_VAULT" \
  --domain frontend \
  --skill hook \
  --json
```

Use explicit constraints when the domain or skill is already known from evidence. Skill names
are vault-dependent: the examples assume the standard coding vault, not built-in routing rules.
For a task spanning separate concerns, such as API contracts and frontend cache behavior,
run a focused search for each concern. Raising `--limit` does not broaden the selected skill
or increase the default three-section reference budget.

Use `route` only when you need a routing decision without document content. A normal `search`
already includes routing, so a preceding `route` call is usually unnecessary.

```bash
node "$KNOWLEDGE_ROUTER_CLI" route \
  "transaction around several Prisma writes" \
  --vault "$KNOWLEDGE_VAULT" \
  --json
```

## Read additional guidance precisely

Use `read` for an explicitly referenced document, a missing section, or fresh source content.
Copy the exact path and section hierarchy from results when available.

```bash
node "$KNOWLEDGE_ROUTER_CLI" read \
  frontend/react-query/references/cache-invalidation.md \
  --section "Cache Invalidation > Rules" \
  --vault "$KNOWLEDGE_VAULT" \
  --json
```

Omit `--section` to read a complete document. Use `--start-line` and `--end-line` instead of
`--section` for a known line range. Line numbers are 1-based and inclusive.

A section ends at the next heading, including a child heading. Reading an `Examples` heading
does not automatically include its child examples. Read the specific child heading you need.
For ambiguous titles, use the full hierarchy; if that is still ambiguous, use a line range.

Read instructions in their context: a section labeled `Bad example` or `Anti-patterns` describes
behavior to avoid. If a selected skill requires root guidance such as `RULES.md`, read that file
explicitly. Generic root documents are not automatically included in every search result.

## Index freshness and failures

The first command creates a missing index automatically. Existing indexes are snapshots:
run a build after knowledge files have been added, edited, or deleted, or when there is evidence
that search results are stale. Do not rebuild before every search.

```bash
node "$KNOWLEDGE_ROUTER_CLI" build \
  --vault "$KNOWLEDGE_VAULT" \
  --json
```

Search returns cached content; `read` returns the current source file. After a vault change,
rebuild and search again before relying on previously returned section names or line ranges.

The default cache is `<vault>/.knowledge/index.json`. For a read-only vault, use a configured
writable external location with `--cache /absolute/path/to/index.json`. Pass that same option
to every build, route, search, and read command. The router does not edit Markdown guidance.

An unresolved query can succeed with confidence `0`, no skill, and no results. Refine it with
concrete technical terms. If it remains unresolved, use applicable project instructions and
targeted source inspection, and state that no matching vault guidance was found when relevant.
Do not invent a skill, claim to have read missing context, or dump the entire vault into context.

A failed command exits with status `1`; with `--json`, its error object is written to stderr.
Inspect the error before retrying. Fix a wrong vault path, unknown constraint, ambiguous section,
or cache location as appropriate. Report malformed YAML with its source path instead of silently
rewriting the vault. If necessary guidance cannot be accessed, report that limitation explicitly.

Deprecated and archived guidance is excluded by default. Use `--include-inactive` only when
the task explicitly requires historical guidance. Stop retrieving once you have enough context
to carry out the task correctly.
