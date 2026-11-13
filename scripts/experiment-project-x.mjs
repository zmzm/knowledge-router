import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { VaultRetriever } from '../dist/index.js';

// Local, opt-in experiment. All generated vault content stays in the chosen output directory.
const { values } = parseArgs({
  options: {
    'coding-vault': { type: 'string' },
    project: { type: 'string' },
    logs: { type: 'string' },
    output: { type: 'string' },
  },
});
for (const option of ['coding-vault', 'project', 'logs', 'output']) {
  if (!values[option]) {
    throw new Error(`Missing --${option}`);
  }
}
const coding = resolve(values['coding-vault']);
const project = resolve(values.project);
const logs = resolve(values.logs);
const output = resolve(values.output);
// Require a new directory so reruns cannot silently mix different source snapshots.
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const vault = join(output, 'vault');
await mkdir(vault);
const baseline = await VaultRetriever.open(coding, {
  cachePath: join(output, 'baseline-index.json'),
  rebuild: true,
});
const baselineIndex = JSON.parse(await readFile(join(output, 'baseline-index.json'), 'utf8'));
for (const doc of baselineIndex.documents) {
  const target = join(vault, doc.path);
  await mkdir(resolve(target, '..'), { recursive: true });
  await writeFile(target, doc.content);
}

const sources = [];
async function copyReference(source, target) {
  const content = await readFile(join(project, source), 'utf8');
  const destination = join(vault, target);
  await mkdir(resolve(destination, '..'), { recursive: true });
  await writeFile(destination, content);
  sources.push({ source, target, sha256: createHash('sha256').update(content).digest('hex') });
  return content;
}
async function skill(name, title, description, body) {
  const directory = join(vault, 'project-x', name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'SKILL.md'),
    `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${title}\n\n${body}\n\n` +
      '## Source boundaries\n\n' +
      'Local Project X documentation snapshot for a retrieval experiment. Requirements and plans describe intent; ' +
      'execution reports are agent-authored claims, not independently verified implementation facts. ' +
      'Read the dated sources and verify current code before treating a behavior as implemented.\n',
  );
}
await skill(
  'overview',
  'Project X Platform Overview',
  'Project X platform architecture, setup, development history and shared test utilities.',
  'Project documentation is available in references/README.md, references/SUMMARY.md and references/test-utils.md.',
);
for (const [source, name] of [
  ['README.md', 'README.md'],
  ['SUMMARY.md', 'SUMMARY.md'],
  ['libs/test-utils/README.md', 'test-utils.md'],
]) {
  await copyReference(source, `project-x/overview/references/${name}`);
}

const month = '.opencode/tasks/11-november-2026';
for (const week of (await readdir(join(project, month))).sort()) {
  if (!/^week-[123]-/.test(week)) {
    continue;
  }
  for (const name of (await readdir(join(project, month, week))).sort()) {
    const directory = join(project, month, week, name);
    // A task bundle is a directory containing task.md; ignore week README files.
    if (name.endsWith('.md')) {
      continue;
    }
    const task = await readFile(join(directory, 'task.md'), 'utf8');
    const title = task.match(/^#\s+(.+)$/m)?.[1] ?? name;
    const goal = task.match(/## Goal\s*\n([^\n]+)/)?.[1] ?? title;
    // Metadata comes from source title/goal, without tuning it to observed queries.
    await skill(name, `Project X: ${title}`, goal, task);
    sources.push({
      source: `${month}/${week}/${name}/task.md`,
      target: `project-x/${name}/SKILL.md`,
      sha256: createHash('sha256').update(task).digest('hex'),
      adapted: true,
    });
    for (const file of (await readdir(directory))
      .filter((file) => file.endsWith('.md') && file !== 'task.md')
      .sort()) {
      await copyReference(
        `${month}/${week}/${name}/${file}`,
        `project-x/${name}/references/${file}`,
      );
    }
  }
}
const experimental = await VaultRetriever.open(vault, { rebuild: true });
const requests = [];
for (const file of (await readdir(logs))
  .filter((file) => /^2026110[123]_.*\.log$/.test(file))
  .sort()) {
  const lines = (await readFile(join(logs, file), 'utf8')).split('\n');
  let stage;
  for (const [index, line] of lines.entries()) {
    if (line.startsWith('$ ')) {
      stage = line.match(/--agent\s+(\S+)/)?.[1];
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const command = event.part?.state?.input?.command ?? '';
    const match = command.match(/scripts\/knowledge search\s+("(?:[^"\\]|\\.)*")/);
    if (event.part?.tool !== 'bash' || !match) {
      continue;
    }
    const request = { query: JSON.parse(match[1]) };
    for (const option of ['domain', 'skill', 'limit']) {
      const argument = command.match(new RegExp(`--${option}\\s+(\\S+)`))?.[1];
      if (argument !== undefined) {
        request[option] = option === 'limit' ? Number(argument) : argument;
      }
    }
    const paths = [...command.matchAll(/--path\s+(\S+)/g)].map((item) => item[1]);
    if (paths.length) {
      request.paths = paths;
    }
    requests.push({ source: { file, line: index + 1, stage }, request });
  }
}
if (!requests.length) {
  throw new Error('No observed search requests found');
}
async function search(retriever, request) {
  try {
    const response = await retriever.search(request);
    return {
      route: response.route,
      results: response.results.map(({ path, section, score, hash }) => ({
        path,
        section,
        score,
        hash,
      })),
    };
  } catch (error) {
    return { error: error.message };
  }
}
const cases = [];
for (const entry of requests) {
  cases.push({
    ...entry,
    baseline: await search(baseline, entry.request),
    experimental: await search(experimental, entry.request),
    // Diagnostic mode tests availability of project context when explicitly requested.
    projectOnly: await search(experimental, {
      ...entry.request,
      domain: 'project-x',
      skill: undefined,
    }),
  });
}
const experimentIndex = JSON.parse(await readFile(join(vault, '.knowledge/index.json'), 'utf8'));
const report = {
  generatedAt: new Date().toISOString(),
  limitation:
    'Current-document replay; includes plans/reports produced after original searches. No historical accuracy claim.',
  codingVault: coding,
  project,
  vault,
  documents: {
    baseline: baselineIndex.documents.length,
    experimental: experimentIndex.documents.length,
  },
  sources,
  cases,
};
await writeFile(join(output, 'comparison.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({ output, vault, documents: report.documents, requests: cases.length }, null, 2),
);
