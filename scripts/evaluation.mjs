export function validateDataset(dataset) {
  if (dataset.schemaVersion !== 1 || !Array.isArray(dataset.cases) || !dataset.cases.length) {
    throw new Error('Dataset must have schemaVersion 1 and a non-empty cases array');
  }
  const ids = new Set();
  for (const item of dataset.cases) {
    if (
      typeof item.id !== 'string' ||
      !item.id ||
      ids.has(item.id) ||
      typeof item.request?.query !== 'string' ||
      !item.request.query.trim() ||
      !Array.isArray(item.expected?.routes) ||
      !item.expected.routes.every(
        (route) => typeof route.domain === 'string' && typeof route.skill === 'string',
      ) ||
      !Array.isArray(item.expected.documents) ||
      !item.expected.documents.every((path) => typeof path === 'string' && path.length > 0) ||
      (!item.expected.routes.length && item.expected.documents.length)
    ) {
      throw new Error(`Invalid or duplicate evaluation case: ${item.id}`);
    }
    ids.add(item.id);
  }
}

/** Labels are independent of retrieval scores. Empty routes mean the engine should abstain. */
export async function evaluateCases(
  cases,
  search,
  { k = 5, confidenceThreshold = 0.5, maxSkills } = {},
) {
  if (
    !Number.isSafeInteger(k) ||
    k < 1 ||
    !Number.isFinite(confidenceThreshold) ||
    confidenceThreshold < 0 ||
    confidenceThreshold > 1
  ) {
    throw new Error(
      'Evaluation requires positive integer k and confidenceThreshold between 0 and 1',
    );
  }
  if (maxSkills !== undefined && maxSkills !== 1 && maxSkills !== 2) {
    throw new Error('maxSkills must be 1 or 2');
  }
  const details = [];
  for (const item of cases) {
    const request = {
      ...item.request,
      limit: k,
      ...(maxSkills === undefined ? {} : { maxSkills }),
    };
    const response = await search(request);
    const acceptable = item.expected.routes;
    const matches = (route) =>
      acceptable.some(
        (expected) => expected.domain === route?.domain && expected.skill === route?.skill,
      );
    const routeCorrect = acceptable.length ? matches(response.route) : !response.route.skill;
    const candidates = [response.route, ...(response.route.alternatives ?? [])].slice(0, 3);
    const routeRecallAt3 = acceptable.length ? candidates.some(matches) : !response.route.skill;
    const documents = [...new Set(item.expected.documents)];
    const returned = [...new Set(response.results.slice(0, k).map((result) => result.path))];
    const found = documents.filter((path) => returned.includes(path));
    const confident =
      !request.skill && !!response.route.skill && response.route.confidence >= confidenceThreshold;
    details.push({
      id: item.id,
      query: item.request.query,
      tags: item.tags ?? [],
      expected: item.expected,
      actual: {
        route: response.route,
        relatedRoutes: response.relatedRoutes ?? [],
        documents: returned,
      },
      routeCorrect: !!routeCorrect,
      routeRecallAt3: !!routeRecallAt3,
      documentRecallAtK: documents.length ? found.length / documents.length : null,
      missingDocuments: documents.filter((path) => !returned.includes(path)),
      negative: !acceptable.length,
      confident,
      confidentError: confident && !routeCorrect,
    });
  }
  return {
    k,
    confidenceThreshold,
    maxSkills: maxSkills ?? 'per-case',
    metrics: aggregate(details),
    byTag: Object.fromEntries(
      [...new Set(details.flatMap((item) => item.tags))]
        .sort()
        .map((tag) => [tag, aggregate(details.filter((item) => item.tags.includes(tag)))]),
    ),
    cases: details,
  };
}

function aggregate(items) {
  const positive = items.filter((item) => !item.negative);
  const negative = items.filter((item) => item.negative);
  const withDocuments = items.filter((item) => item.documentRecallAtK !== null);
  const confident = items.filter((item) => item.confident);
  const mean = (values) =>
    values.length ? values.reduce((sum, value) => sum + Number(value), 0) / values.length : null;
  return {
    cases: items.length,
    routeAccuracy: mean(items.map((item) => item.routeCorrect)),
    positiveRouteAccuracy: mean(positive.map((item) => item.routeCorrect)),
    abstentionAccuracy: mean(negative.map((item) => item.routeCorrect)),
    routeRecallAt3: mean(items.map((item) => item.routeRecallAt3)),
    documentRecallAtK: mean(withDocuments.map((item) => item.documentRecallAtK)),
    confidentRoutes: confident.length,
    confidentErrors: confident.filter((item) => item.confidentError).length,
    confidentErrorRate: mean(confident.map((item) => item.confidentError)),
  };
}

export function checkThresholds(metrics, thresholds) {
  const failures = [];
  for (const [name, range] of Object.entries(thresholds)) {
    const value = metrics[name];
    if (
      !(name in metrics) ||
      !range ||
      (range.min === undefined && range.max === undefined) ||
      Object.values(range).some((bound) => typeof bound !== 'number' || !Number.isFinite(bound))
    ) {
      throw new Error(`Invalid evaluation threshold: ${name}`);
    }
    if (
      value === null ||
      (range.min !== undefined && value < range.min) ||
      (range.max !== undefined && value > range.max)
    ) {
      failures.push(`${name}: ${value} outside ${JSON.stringify(range)}`);
    }
  }
  return failures;
}
