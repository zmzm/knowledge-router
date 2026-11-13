import { parseArgs } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultRetriever } from '../dist/index.js';
import { checkThresholds, evaluateCases, validateDataset } from './evaluation.mjs';

async function main() {
  const { values } = parseArgs({
    options: {
      dataset: { type: 'string' },
      vault: { type: 'string' },
      k: { type: 'string' },
      'max-skills': { type: 'string' },
      'confidence-threshold': { type: 'string' },
      check: { type: 'boolean' },
      summary: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: npm run eval -- [--dataset eval/flowforge.json --vault /path/to/coding] [--k 5] [--max-skills 2] [--confidence-threshold 0.5] [--check] [--summary]',
    );
    return;
  }
  const datasetPath = values.dataset
    ? resolve(values.dataset)
    : fileURLToPath(new URL('../eval/fixtures.json', import.meta.url));
  const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
  validateDataset(dataset);
  if (!values.vault && typeof dataset.vault !== 'string') {
    throw new Error('This dataset requires --vault /path/to/coding');
  }
  if (values.check && (!dataset.thresholds || !Object.keys(dataset.thresholds).length)) {
    throw new Error(
      '--check requires dataset thresholds; use reporting mode for unbaselined datasets',
    );
  }
  const vault = values.vault ? resolve(values.vault) : resolve(dirname(datasetPath), dataset.vault);
  const temporary = await mkdtemp(join(tmpdir(), 'knowledge-router-eval-'));
  try {
    const retriever = await VaultRetriever.open(vault, {
      cachePath: join(temporary, 'index.json'),
    });
    // Missing labels are dataset errors, not retrieval misses.
    for (const path of new Set(dataset.cases.flatMap((item) => item.expected.documents))) {
      await retriever.read({ path });
    }
    for (const route of dataset.cases.flatMap((item) => item.expected.routes)) {
      await retriever.route({
        query: 'validate evaluation label',
        domain: route.domain,
        skill: route.skill,
      });
    }
    for (const section of dataset.cases.flatMap((item) => item.expected.sections ?? [])) {
      await retriever.read({ path: section.path, section: section.section });
    }
    const report = await evaluateCases(dataset.cases, (request) => retriever.search(request), {
      k: values.k === undefined ? 5 : Number(values.k),
      maxSkills: values['max-skills'] === undefined ? undefined : Number(values['max-skills']),
      confidenceThreshold:
        values['confidence-threshold'] === undefined ? 0.5 : Number(values['confidence-threshold']),
    });
    const failures = values.check ? checkThresholds(report.metrics, dataset.thresholds) : [];
    const output = values.summary
      ? {
          k: report.k,
          confidenceThreshold: report.confidenceThreshold,
          maxSkills: report.maxSkills,
          metrics: report.metrics,
        }
      : report;
    console.log(
      JSON.stringify(
        {
          dataset: dataset.name,
          ...output,
          ...(values.check ? { check: { passed: !failures.length, failures } } : {}),
        },
        null,
        2,
      ),
    );
    if (failures.length) {
      process.exitCode = 1;
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
});
