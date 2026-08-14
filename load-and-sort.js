const { chromium } = require('playwright');
const fs = require('fs');

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_LOAD_MORE_CLICKS = 60;
const STABLE_ROUNDS_TO_STOP = 2; // stop if article count doesn't grow for this many consecutive clicks

// CLI-facing vocabulary -> real tryp.com query param values (verified via live DOM/network inspection)
const BUDGET_LABEL_TO_VALUE = {
  budget: 'cheap', // UI checkbox labeled "Budget"
  comfort: 'comfort',
  luxury: 'luxury',
};

const ACCOMMODATION_TYPE_TO_VALUE = {
  any: '', // default-checked radio; omit accommodationType from the URL when selected
  hotel: 'Hotel',
  hostel: 'Hostel',
  apartment: 'Apartments', // API value is plural despite the UI label being singular
};

const KNOWN_OPTION_KEYS = new Set([
  'runs', 'concurrency', 'location', 'adults', 'children', 'infants',
  'budget', 'accommodation', 'avoid', 'top', 'minDays',
]);

function printHelp() {
  console.log(`Usage: node load-and-sort.js [options]

Runs one or more concurrent AI-generated tryp.com holiday searches, dedupes
the results across all runs, and prints/saves them sorted by lowest price.

Options:
  --runs=N              Number of independent search sessions to run.
                        (default: 5)
  --concurrency=N       Max number of sessions to run at the same time.
                        (default: 3)
  --location=CODE       5-letter departure location code, e.g. IEORK, IEDUB,
                        DEBER, DEFRA.
                        (default: IEORK)
  --adults=N            Number of adult travellers per search.
                        (default: 1)
  --children=N          Number of children (ages 2-13) per search.
                        (default: 0)
  --infants=N           Number of infants (under 2) per search.
                        (default: 0)
  --budget=LIST         Comma-separated budget tiers to include (any of
                        budget, comfort, luxury). Case-insensitive.
                        (default: comfort)
  --accommodation=TYPE  Type of accommodation: any, hotel, hostel,
                        apartment. Case-insensitive.
                        (default: hotel)
  --avoid=LIST          Comma-separated location codes to avoid, e.g.
                        GB-ENG,US.
                        (default: GB-ENG)
  --top=N               Number of cheapest trips to print to the console.
                        (default: 50)
  --min-days=N          Minimum trip length (in days) for a trip to count
                        towards --top. Shorter trips are skipped over (but
                        still included in results.json).
                        (default: 0, no minimum)
  --no-save             Don't write the full results to results.json —
                        only print the top trips to the console.
  --help, -h            Show this help message and exit.

Examples:
  node load-and-sort.js
  node load-and-sort.js --runs=10 --concurrency=5
  node load-and-sort.js --location=DEBER --adults=2
  node load-and-sort.js --top=10 --min-days=5
  node load-and-sort.js --accommodation=apartment --budget=budget,luxury --children=2 --avoid=GB-ENG,US
`);
}

function parseArgs(argv) {
  const opts = {
    runs: 5,
    concurrency: 3,
    location: 'IEORK',
    adults: 1,
    children: 0,
    infants: 0,
    top: 50,
    minDays: 0,
    budget: ['comfort'],
    accommodation: 'hotel',
    avoid: ['GB-ENG'],
    save: true,
  };
  for (const arg of argv) {
    if (arg === '--no-save') {
      opts.save = false;
      continue;
    }
    const m = arg.match(/^--([a-zA-Z-]+)=(.+)$/);
    if (!m) {
      throw new Error(`Unrecognized argument "${arg}" — expected the form --flag=value. Run with --help for usage.`);
    }
    const [, rawKey, value] = m;
    const key = rawKey === 'min-days' ? 'minDays' : rawKey;
    if (!KNOWN_OPTION_KEYS.has(key)) {
      throw new Error(`Unknown option "--${rawKey}" — run with --help to see available options.`);
    }
    switch (key) {
      case 'runs':
      case 'concurrency':
      case 'adults':
      case 'children':
      case 'infants':
      case 'top':
      case 'minDays':
        opts[key] = parseInt(value, 10);
        break;
      case 'location':
        opts.location = value.toUpperCase();
        break;
      case 'budget':
        opts.budget = value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        break;
      case 'accommodation':
        opts.accommodation = value.trim().toLowerCase();
        break;
      case 'avoid':
        opts.avoid = value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
        break;
    }
  }

  if (!Number.isInteger(opts.runs) || opts.runs < 1) {
    throw new Error(`Invalid --runs "${opts.runs}" — expected a positive integer.`);
  }
  if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1) {
    throw new Error(`Invalid --concurrency "${opts.concurrency}" — expected a positive integer.`);
  }
  if (!/^[A-Z]{5}$/.test(opts.location)) {
    throw new Error(`Invalid --location "${opts.location}" — expected a 5-letter code like IEORK or DEBER.`);
  }
  if (!Number.isInteger(opts.adults) || opts.adults < 1) {
    throw new Error(`Invalid --adults "${opts.adults}" — expected a positive integer.`);
  }
  if (!Number.isInteger(opts.children) || opts.children < 0) {
    throw new Error(`Invalid --children "${opts.children}" — expected a non-negative integer.`);
  }
  if (!Number.isInteger(opts.infants) || opts.infants < 0) {
    throw new Error(`Invalid --infants "${opts.infants}" — expected a non-negative integer.`);
  }
  if (!Number.isInteger(opts.top) || opts.top < 1) {
    throw new Error(`Invalid --top "${opts.top}" — expected a positive integer.`);
  }
  if (!Number.isInteger(opts.minDays) || opts.minDays < 0) {
    throw new Error(`Invalid --min-days "${opts.minDays}" — expected a non-negative integer.`);
  }
  if (
    opts.budget.length === 0 ||
    !opts.budget.every((b) => Object.prototype.hasOwnProperty.call(BUDGET_LABEL_TO_VALUE, b))
  ) {
    throw new Error(
      `Invalid --budget "${opts.budget.join(',')}" — expected a comma-separated list from: ${Object.keys(BUDGET_LABEL_TO_VALUE).join(', ')}.`
    );
  }
  if (!Object.prototype.hasOwnProperty.call(ACCOMMODATION_TYPE_TO_VALUE, opts.accommodation)) {
    throw new Error(
      `Invalid --accommodation "${opts.accommodation}" — expected one of: ${Object.keys(ACCOMMODATION_TYPE_TO_VALUE).join(', ')}.`
    );
  }
  if (opts.avoid.length === 0) {
    throw new Error(`Invalid --avoid "${opts.avoid.join(',')}" — expected a comma-separated list of location codes, e.g. GB-ENG,US.`);
  }

  return opts;
}

function buildSearchUrl({ location, adults, children, infants, budget, accommodation, avoid }) {
  const accommodationType = ACCOMMODATION_TYPE_TO_VALUE[accommodation];

  const params = new URLSearchParams({
    initialLocation: location,
    ...(accommodationType ? { accommodationType } : {}),
    budget: budget.map((b) => BUDGET_LABEL_TO_VALUE[b]).join(','),
    avoidLocations: avoid.join(','),
    n_adults: String(adults),
    ...(children > 0 ? { n_children: String(children) } : {}),
    ...(infants > 0 ? { n_babies: String(infants) } : {}),
  });
  return `https://www.tryp.com/en/holidays?${params.toString()}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function waitForSkeletonsGone(page, maxWaitMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const skeletonCount = await page.locator('[class*="skeleton" i]').count();
    if (skeletonCount === 0) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function dismissModalIfPresent(page) {
  const closeBtn = page.locator('.chakra-modal__content-container button[aria-label="Close"]');
  if (await closeBtn.count()) {
    await closeBtn.first().click({ timeout: 3000 }).catch(() => { });
    await page.waitForTimeout(300);
  }
}

function parsePrice(str) {
  if (!str) return null;
  const cleaned = str.replace(/[^\d,.-]/g, '').replace(/,/g, '');
  const value = parseFloat(cleaned);
  return Number.isNaN(value) ? null : value;
}

async function extractTrips(page) {
  return page.$$eval('article', (articles) =>
    articles.map((el) => {
      const text = el.innerText || '';
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

      const titleLine = lines.find((l) => /^\d+\s+days?\s*-\s*.+/i.test(l)) || null;
      const titleIdx = titleLine ? lines.indexOf(titleLine) : -1;
      const destinationLine = titleIdx >= 0 ? lines[titleIdx + 1] || null : null;

      const prices = [...text.matchAll(/[€$£]\s?[\d.,]+/g)].map((m) => m[0]);
      const dateRangeMatch = text.match(/[A-Za-z]{3}, \d{1,2} [A-Za-z]{3} - [A-Za-z]{3}, \d{1,2} [A-Za-z]{3}/);
      const link = el.closest('a');

      return {
        title: titleLine,
        destination: destinationLine,
        dates: dateRangeMatch ? dateRangeMatch[0] : null,
        priceText: prices[0] || null,
        originalPriceText: prices[1] || null,
        breakfastIncluded: /breakfast included/i.test(text),
        bestseller: /bestseller/i.test(text),
        href: link ? link.getAttribute('href') : null,
        rawText: text,
      };
    })
  );
}

async function runSearch(browser, runIndex, searchUrl) {
  const log = (msg) => console.log(`[run ${runIndex}] ${msg}`);

  // Stagger session start so concurrent runs don't all hit the search API in the same instant.
  await sleep(randomInt(200, 1500));

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1400, height: 900 },
  });

  try {
    const page = await context.newPage();

    log('Navigating to search results...');
    await page.goto(searchUrl, { waitUntil: 'load' });

    try {
      await page.getByRole('button', { name: 'Accept' }).click({ timeout: 5000 });
      log('Accepted cookie banner.');
    } catch {
      // no cookie banner shown
    }

    log('Waiting for initial results to finish generating...');
    await waitForSkeletonsGone(page);
    log(`Initial trips loaded: ${await page.locator('article').count()}`);

    let stableRounds = 0;
    let lastCount = await page.locator('article').count();

    for (let i = 1; i <= MAX_LOAD_MORE_CLICKS; i++) {
      await dismissModalIfPresent(page);

      const loadMoreBtn = page.locator('#load-more-packages-button');
      if (!(await loadMoreBtn.count()) || !(await loadMoreBtn.isVisible())) {
        log('No more "load more" button — all results loaded.');
        break;
      }

      await loadMoreBtn.click().catch(async () => {
        await dismissModalIfPresent(page);
        await loadMoreBtn.click({ timeout: 5000 }).catch(() => { });
      });

      await page.waitForTimeout(1000);
      await waitForSkeletonsGone(page);

      const count = await page.locator('article').count();
      log(`Click ${i}: ${count} trips loaded so far.`);

      if (count <= lastCount) {
        stableRounds += 1;
        if (stableRounds >= STABLE_ROUNDS_TO_STOP) {
          log('Trip count stopped increasing — assuming all results are in.');
          break;
        }
      } else {
        stableRounds = 0;
      }
      lastCount = count;
    }

    await dismissModalIfPresent(page);

    log('Extracting trip data...');
    const rawTrips = await extractTrips(page);
    log(`Collected ${rawTrips.length} raw trips.`);
    return rawTrips;
  } finally {
    await context.close();
  }
}

async function runSearchSafe(browser, runIndex, searchUrl) {
  try {
    const trips = await runSearch(browser, runIndex, searchUrl);
    return { runIndex, status: 'fulfilled', trips };
  } catch (err) {
    console.warn(`[run ${runIndex}] failed: ${err.message}`);
    return { runIndex, status: 'rejected', trips: [] };
  }
}

async function runPool(browser, totalRuns, concurrency, searchUrl) {
  const results = new Array(totalRuns);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < totalRuns) {
      const i = nextIndex++;
      results[i] = await runSearchSafe(browser, i + 1, searchUrl);
    }
  }

  const workerCount = Math.min(concurrency, totalRuns);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

function aggregateAndDedup(outcomes, searchUrl) {
  const seen = new Set();
  const trips = [];

  for (const outcome of outcomes) {
    for (const t of outcome.trips) {
      const price = parsePrice(t.priceText);
      if (price === null) continue;

      const idMatch = t.href ? t.href.match(/packages\/(\d+)/) : null;
      const key = (idMatch && idMatch[1]) || t.href || t.rawText;
      if (seen.has(key)) continue;
      seen.add(key);

      const daysMatch = t.title ? t.title.match(/^(\d+)/) : null;
      const days = daysMatch ? parseInt(daysMatch[1], 10) : null;

      trips.push({
        ...t,
        price,
        originalPrice: parsePrice(t.originalPriceText),
        url: t.href ? new URL(t.href, searchUrl).toString() : null,
        sourceRun: outcome.runIndex,
        days,
      });
    }
  }

  trips.sort((a, b) => a.price - b.price);
  return trips;
}

function formatTripLines(trips) {
  const rows = trips.map((t) => ({
    priceBase: `€${t.price}`,
    discount: t.originalPrice ? `(was €${t.originalPrice})` : '',
    title: t.title || '',
    destination: t.destination || '',
    dates: t.dates || '',
    run: `[run ${t.sourceRun}]`,
    url: t.url || '',
  }));

  const widthOf = (key) => Math.max(0, ...rows.map((r) => r[key].length));
  const widths = {
    priceBase: widthOf('priceBase'),
    discount: widthOf('discount'),
    title: widthOf('title'),
    destination: widthOf('destination'),
    dates: widthOf('dates'),
    run: widthOf('run'),
  };

  return rows.map(
    (r) =>
      `${r.priceBase.padEnd(widths.priceBase)}  ${r.discount.padEnd(widths.discount)}  |  ${r.title.padEnd(widths.title)}  |  ${r.destination.padEnd(widths.destination)}  |  ${r.dates.padEnd(widths.dates)}  |  ${r.run.padEnd(widths.run)}  |  ${r.url}`
  );
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  const { runs, concurrency, location, adults, children, infants, top, minDays, budget, accommodation, avoid, save } = parseArgs(argv);
  const searchUrl = buildSearchUrl({ location, adults, children, infants, budget, accommodation, avoid });
  console.log(
    `Running ${runs} search${runs === 1 ? '' : 'es'} (concurrency ${concurrency}, location=${location}, adults=${adults}, children=${children}, infants=${infants}, budget=${budget.join(',')}, accommodation=${accommodation}, avoid=${avoid.join(',')})...\n`
  );

  const browser = await chromium.launch({ headless: true });
  let outcomes;
  try {
    outcomes = await runPool(browser, runs, concurrency, searchUrl);
  } finally {
    await browser.close();
  }

  const succeeded = outcomes.filter((o) => o.status === 'fulfilled').length;
  const failed = outcomes.length - succeeded;
  const totalRaw = outcomes.reduce((sum, o) => sum + o.trips.length, 0);

  const trips = aggregateAndDedup(outcomes, searchUrl);

  if (save) {
    fs.writeFileSync('results.json', JSON.stringify(trips, null, 2));
  }

  const eligibleTrips = trips.filter((t) => (t.days ?? 0) >= minDays);

  console.log(`\nRuns: ${outcomes.length} (${succeeded} succeeded, ${failed} failed)`);
  console.log(`Raw trips collected: ${totalRaw}  |  Unique trips after dedup: ${trips.length}`);
  if (minDays > 0) {
    console.log(`Trips of at least ${minDays} day(s): ${eligibleTrips.length} of ${trips.length}`);
  }
  console.log(`\nTop ${Math.min(top, eligibleTrips.length)} cheapest trips:\n`);

  for (const line of formatTripLines(eligibleTrips.slice(0, top))) {
    console.log(line);
  }

  console.log(
    save
      ? `\nFull data (${trips.length} trips) written to results.json`
      : `\nFull data (${trips.length} trips) not saved (--no-save).`
  );
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs, buildSearchUrl, BUDGET_LABEL_TO_VALUE, ACCOMMODATION_TYPE_TO_VALUE };
