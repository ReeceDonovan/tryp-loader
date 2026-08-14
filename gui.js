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

  const answers = await p.group(
    {
      location: () => pickDepartureLocation(p),
      adults: () =>
        p.text({ message: 'Number of adults', initialValue: '1', validate: intValidator({ min: 1 }) }),
      children: () =>
        p.text({ message: 'Number of children (ages 2-13)', initialValue: '0', validate: intValidator({ min: 0 }) }),
      infants: () =>
        p.text({ message: 'Number of infants (under 2)', initialValue: '0', validate: intValidator({ min: 0 }) }),
      budget: () =>
        p.multiselect({
          message: 'Budget tiers to include',
          options: Object.keys(BUDGET_LABEL_TO_VALUE).map((key) => ({ value: key, label: key })),
          initialValues: ['comfort'],
          required: true,
        }),
      accommodation: () =>
        p.select({
          message: 'Accommodation type',
          options: Object.keys(ACCOMMODATION_TYPE_TO_VALUE).map((key) => ({ value: key, label: key })),
          initialValue: 'hotel',
        }),
      avoid: () =>
        p.text({
          message: 'Location codes to avoid (comma-separated, blank = no filter)',
          initialValue: 'GB-ENG',
        }),
      runs: () =>
        p.text({ message: 'Number of independent search sessions to run', initialValue: '5', validate: intValidator({ min: 1 }) }),
      concurrency: () =>
        p.text({ message: 'Max sessions to run at the same time', initialValue: '3', validate: intValidator({ min: 1 }) }),
      top: () =>
        p.text({ message: 'Number of cheapest trips to print', initialValue: '50', validate: intValidator({ min: 1 }) }),
      minDays: () =>
        p.text({ message: 'Minimum trip length in days (0 = no minimum)', initialValue: '0', validate: intValidator({ min: 0 }) }),
      minRating: () =>
        p.text({ message: 'Minimum accommodation rating in stars, 1-5 (0 = no minimum)', initialValue: '0', validate: intValidator({ min: 0, max: 5 }) }),
      month: () =>
        p.select({
          message: 'Only show trips departing in a specific month?',
          options: [
            { value: '', label: 'No filter' },
            ...MONTHS.map((m) => ({ value: m.abbr.toLowerCase(), label: m.name })),
          ],
          initialValue: '',
        }),
      country: () =>
        p.text({
          message: 'Only show trips to specific countries? (comma-separated, blank = no filter)',
          initialValue: '',
        }),
      save: () =>
        p.confirm({ message: 'Save full results to results.json?', initialValue: true }),
      open: () =>
        p.confirm({ message: 'Open results explorer in your browser when done?', initialValue: true }),
    },
    {
      onCancel: () => {
        p.cancel('Setup cancelled.');
        process.exit(0);
      },
    }
  );

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
