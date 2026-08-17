#!/usr/bin/env node
const {
  main,
  BUDGET_LABEL_TO_VALUE,
  ACCOMMODATION_TYPE_TO_VALUE,
  MONTHS,
} = require('./load-and-sort.js');

// tryp.com's own location search box calls this endpoint. The key/headers below are
// shipped in tryp.com's public client-side JS (visible to any site visitor) -- not a
// private credential of ours, just their public frontend API key.
const LOCATION_SEARCH_URL = 'https://rduu3i7qp8.execute-api.eu-central-1.amazonaws.com/prod/typeahead/v1/search';
const LOCATION_SEARCH_API_KEY = 'xeVlvwPT5C7Z7oq3zEYOJ4yOr9QJpLvC1ofD9d0K';

function intValidator({ min, max }) {
  return (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
      return max !== undefined
        ? `Must be a whole number between ${min} and ${max}.`
        : `Must be a whole number >= ${min}.`;
    }
  };
}

const LOCATION_CODE_RE = /^[a-zA-Z]{5}$/;

function manualLocationPrompt(p) {
  return p.text({
    message: 'Departure location code (e.g. IEORK, IEDUB, DEBER, DEFRA)',
    placeholder: 'IEORK',
    initialValue: 'IEORK',
    validate: (value) => {
      if (!LOCATION_CODE_RE.test(value)) {
        return 'Expected a 5-letter code, e.g. IEORK or DEBER.';
      }
    },
  });
}

async function searchDepartureCities(query) {
  const params = new URLSearchParams({
    initial_location: 'IEORK',
    page: '0',
    pageSize: '20',
    all: 'false',
    query,
  });
  const res = await fetch(`${LOCATION_SEARCH_URL}?${params.toString()}`, {
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      origin: 'https://www.tryp.com',
      referer: 'https://www.tryp.com/',
      'x-api-key': LOCATION_SEARCH_API_KEY,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`tryp.com location search failed (HTTP ${res.status})`);
  }
  const results = await res.json();
  return results.filter((r) => r.isCity && r.locode);
}

function formatCityLabel(match) {
  const parts = [match.value];
  if (match.state && match.state !== match.value) parts.push(match.state);
  if (match.country) parts.push(match.country);
  return parts.join(', ');
}

async function pickDepartureLocation(p) {
  while (true) {
    const query = await p.text({
      message: 'Search for your departure city (e.g. Cork, Dublin, Berlin)',
      placeholder: 'Cork',
    });
    if (p.isCancel(query)) return query;

    const trimmed = query.trim();
    if (LOCATION_CODE_RE.test(trimmed)) {
      return trimmed.toUpperCase();
    }

    let matches;
    try {
      matches = await searchDepartureCities(trimmed);
    } catch (err) {
      p.log.warn(`Could not reach tryp.com's location search (${err.message}). Falling back to manual code entry.`);
      return manualLocationPrompt(p);
    }

    if (matches.length === 0) {
      p.log.warn(`No matches for "${trimmed}" — try a different search.`);
      continue;
    }

    const SEARCH_AGAIN = '__search_again__';
    const choice = await p.select({
      message: 'Select your departure city',
      options: [
        ...matches.map((m) => ({ value: m.locode, label: formatCityLabel(m) })),
        { value: SEARCH_AGAIN, label: '↩ Search again' },
      ],
    });
    if (p.isCancel(choice)) return choice;
    if (choice === SEARCH_AGAIN) continue;
    return choice;
  }
}

const BACK = Symbol('back');
const BACK_LABEL = '⬅ Back';
const BACK_HINT = ' (or type "back" to go back)';

function isBackWord(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'back';
}

function withBackOption(options, canGoBack) {
  return canGoBack ? [...options, { value: BACK, label: BACK_LABEL }] : options;
}

async function textStep(p, canGoBack, { message, validate, ...opts }) {
  const value = await p.text({
    ...opts,
    message: canGoBack ? `${message}${BACK_HINT}` : message,
    validate: (input) => {
      if (canGoBack && isBackWord(input)) return undefined;
      return validate ? validate(input) : undefined;
    },
  });
  if (p.isCancel(value)) return value;
  if (canGoBack && isBackWord(value)) return BACK;
  return value;
}

async function selectStep(p, canGoBack, { options, ...opts }) {
  return p.select({ ...opts, options: withBackOption(options, canGoBack) });
}

async function multiselectStep(p, canGoBack, { options, ...opts }) {
  const value = await p.multiselect({ ...opts, options: withBackOption(options, canGoBack) });
  if (p.isCancel(value)) return value;
  if (canGoBack && value.includes(BACK)) return BACK;
  return value;
}

async function confirmSelectStep(p, canGoBack, { message, initialValue }) {
  const options = withBackOption(
    [
      { value: true, label: 'Yes' },
      { value: false, label: 'No' },
    ],
    canGoBack
  );
  return p.select({ message, options, initialValue });
}

async function run() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      'gui.js needs an interactive terminal (TTY). For scripted/automated use, run load-and-sort.js directly with --flags instead.'
    );
    process.exitCode = 1;
    return;
  }

  const p = await import('@clack/prompts');

  p.intro('tryp.com holiday search — setup wizard');

  const answers = {};

  const steps = [
    { key: 'location', run: () => pickDepartureLocation(p) },
    {
      key: 'adults',
      run: (canGoBack) =>
        textStep(p, canGoBack, {
          message: 'Number of adults',
          initialValue: answers.adults ?? '1',
          validate: intValidator({ min: 1 }),
        }),
    },
    {
      key: 'children',
      run: (canGoBack) =>
        textStep(p, canGoBack, {
          message: 'Number of children (ages 2-13)',
          initialValue: answers.children ?? '0',
          validate: intValidator({ min: 0 }),
        }),
    },
    {
      key: 'infants',
      run: (canGoBack) =>
        textStep(p, canGoBack, {
          message: 'Number of infants (under 2)',
          initialValue: answers.infants ?? '0',
          validate: intValidator({ min: 0 }),
        }),
    },
    {
      key: 'budget',
      run: (canGoBack) =>
        multiselectStep(p, canGoBack, {
          message: 'Budget tiers to include',
          options: Object.keys(BUDGET_LABEL_TO_VALUE).map((key) => ({ value: key, label: key })),
          initialValues: answers.budget ?? ['comfort'],
          required: true,
        }),
    },
    {
      key: 'accommodation',
      run: (canGoBack) =>
        selectStep(p, canGoBack, {
          message: 'Accommodation type',
          options: Object.keys(ACCOMMODATION_TYPE_TO_VALUE).map((key) => ({ value: key, label: key })),
          initialValue: answers.accommodation ?? 'hotel',
        }),
    },
    {
      key: 'avoid',
      run: (canGoBack) =>
        textStep(p, canGoBack, {
          message: 'Location codes to avoid (comma-separated, blank = no filter)',
          initialValue: answers.avoid ?? 'GB-ENG',
        }),
    },
    {
      key: 'runs',
      run: (canGoBack) =>
        textStep(p, canGoBack, {
          message: 'Number of independent search sessions to run',
          initialValue: answers.runs ?? '5',
          validate: intValidator({ min: 1 }),
        }),
    },
    {
      key: 'concurrency',
      run: (canGoBack) =>
        textStep(p, canGoBack, {
          message: 'Max sessions to run at the same time',
          initialValue: answers.concurrency ?? '3',
          validate: intValidator({ min: 1 }),
        }),
    },
    {
      key: 'top',
      run: (canGoBack) =>
        textStep(p, canGoBack, {
          message: 'Number of cheapest trips to print',
          initialValue: answers.top ?? '50',
          validate: intValidator({ min: 1 }),
        }),
    },
    {
      key: 'minDays',
      run: (canGoBack) =>
        textStep(p, canGoBack, {
          message: 'Minimum trip length in days (0 = no minimum)',
          initialValue: answers.minDays ?? '0',
          validate: intValidator({ min: 0 }),
        }),
    },
    {
      key: 'minRating',
      run: (canGoBack) =>
        textStep(p, canGoBack, {
          message: 'Minimum accommodation rating in stars, 1-5 (0 = no minimum)',
          initialValue: answers.minRating ?? '0',
          validate: intValidator({ min: 0, max: 5 }),
        }),
    },
    {
      key: 'month',
      run: (canGoBack) =>
        selectStep(p, canGoBack, {
          message: 'Only show trips departing in a specific month?',
          options: [
            { value: '', label: 'No filter' },
            ...MONTHS.map((m) => ({ value: m.abbr.toLowerCase(), label: m.name })),
          ],
          initialValue: answers.month ?? '',
        }),
    },
    {
      key: 'country',
      run: (canGoBack) =>
        textStep(p, canGoBack, {
          message: 'Only show trips to specific countries? (comma-separated, blank = no filter)',
          initialValue: answers.country ?? '',
        }),
    },
    {
      key: 'save',
      run: (canGoBack) =>
        confirmSelectStep(p, canGoBack, {
          message: 'Save full results to results.json?',
          initialValue: answers.save ?? true,
        }),
    },
    {
      key: 'open',
      run: (canGoBack) =>
        confirmSelectStep(p, canGoBack, {
          message: 'Open results explorer in your browser when done?',
          initialValue: answers.open ?? true,
        }),
    },
  ];

  let stepIndex = 0;
  while (stepIndex < steps.length) {
    const step = steps[stepIndex];
    const canGoBack = stepIndex > 0;
    const result = await step.run(canGoBack);
    if (p.isCancel(result)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }
    if (result === BACK) {
      stepIndex = Math.max(0, stepIndex - 1);
      continue;
    }
    answers[step.key] = result;
    stepIndex += 1;
  }

  p.outro('Starting search...');

  const argv = [
    `--location=${answers.location}`,
    `--adults=${answers.adults}`,
    `--children=${answers.children}`,
    `--infants=${answers.infants}`,
    `--budget=${answers.budget.join(',')}`,
    `--accommodation=${answers.accommodation}`,
    `--avoid=${answers.avoid}`,
    `--runs=${answers.runs}`,
    `--concurrency=${answers.concurrency}`,
    `--top=${answers.top}`,
    `--min-days=${answers.minDays}`,
    `--min-rating=${answers.minRating}`,
  ];
  if (answers.month) {
    argv.push(`--month=${answers.month}`);
  }
  if (answers.country && answers.country.trim()) {
    argv.push(`--country=${answers.country.trim()}`);
  }
  if (!answers.save) {
    argv.push('--no-save');
  }
  if (!answers.open) {
    argv.push('--no-open');
  }

  try {
    await main(argv);
  } catch (err) {
    p.log.error(err.message);
    process.exitCode = 1;
  }
}

run();
