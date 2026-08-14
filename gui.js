#!/usr/bin/env node
const {
  main,
  BUDGET_LABEL_TO_VALUE,
  ACCOMMODATION_TYPE_TO_VALUE,
  MONTHS,
} = require('./load-and-sort.js');

function intValidator({ min }) {
  return (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min) {
      return `Must be a whole number >= ${min}.`;
    }
  };
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
      location: () =>
        p.text({
          message: 'Departure location code (e.g. IEORK, IEDUB, DEBER, DEFRA)',
          placeholder: 'IEORK',
          initialValue: 'IEORK',
          validate: (value) => {
            if (!/^[a-zA-Z]{5}$/.test(value)) {
              return 'Expected a 5-letter code, e.g. IEORK or DEBER.';
            }
          },
        }),
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
          message: 'Location codes to avoid (comma-separated)',
          initialValue: 'GB-ENG',
          validate: (value) => {
            const codes = value.split(',').map((s) => s.trim()).filter(Boolean);
            if (codes.length === 0) return 'Enter at least one location code, e.g. GB-ENG,US.';
          },
        }),
      runs: () =>
        p.text({ message: 'Number of independent search sessions to run', initialValue: '5', validate: intValidator({ min: 1 }) }),
      concurrency: () =>
        p.text({ message: 'Max sessions to run at the same time', initialValue: '3', validate: intValidator({ min: 1 }) }),
      top: () =>
        p.text({ message: 'Number of cheapest trips to print', initialValue: '50', validate: intValidator({ min: 1 }) }),
      minDays: () =>
        p.text({ message: 'Minimum trip length in days (0 = no minimum)', initialValue: '0', validate: intValidator({ min: 0 }) }),
      month: () =>
        p.select({
          message: 'Only show trips departing in a specific month?',
          options: [
            { value: '', label: 'No filter' },
            ...MONTHS.map((m) => ({ value: m.abbr.toLowerCase(), label: m.name })),
          ],
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
  ];
  if (answers.month) {
    argv.push(`--month=${answers.month}`);
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
