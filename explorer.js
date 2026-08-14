const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// JS string literals historically disallowed raw U+2028/U+2029 even though
// JSON strings permit them. Built from character codes (rather than typed
// literally) so the source file never has to contain the raw characters.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/**
 * Serializes trips into text that's safe to drop into `const TRIPS = <this>;`
 * inside an inline <script> tag. Escaping every "<" (not just "</script")
 * prevents a scraped field from ever being able to close the tag early, and
 * escaping the line/paragraph separators above closes the JSON-vs-JS-string
 * gap noted there. \uXXXX escapes are valid in both JSON and JS, so the
 * result is still a plain array literal -- no JSON.parse() needed on the client.
 */
function serializeTripsForScript(trips) {
  return JSON.stringify(trips)
    .split('<').join('\\u003C')
    .split(LINE_SEPARATOR).join('\\u2028')
    .split(PARAGRAPH_SEPARATOR).join('\\u2029');
}

const CSS = `
:root {
  color-scheme: light dark;
  --ink: #17221f;
  --ink-soft: #4c5850;
  --paper: #f5f7f3;
  --surface: #ffffff;
  --rule: #dde3da;
  --teal: #0f766e;
  --teal-soft: #e3f1ef;
  --amber: #a9720c;
  --amber-soft: #fbf0da;
  --rose: #9c3b3b;
  --radius: 8px;
  --shadow: 0 1px 2px rgba(23, 34, 31, 0.06), 0 4px 12px rgba(23, 34, 31, 0.05);
}

@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e8ece9;
    --ink-soft: #a7b3ac;
    --paper: #101613;
    --surface: #161d1a;
    --rule: #2a332e;
    --teal: #34d6c6;
    --teal-soft: rgba(52, 214, 198, 0.12);
    --amber: #e0ab48;
    --amber-soft: rgba(224, 171, 72, 0.14);
    --rose: #e08787;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 4px 16px rgba(0, 0, 0, 0.35);
  }
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}

.wrap {
  max-width: 1180px;
  margin: 0 auto;
  padding: 28px 24px 64px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

header.top {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 24px;
}

.eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--teal);
  margin: 0 0 6px;
}

.hero-count {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 34px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
  color: var(--ink);
}

.hero-count .unit {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 16px;
  font-weight: 500;
  color: var(--ink-soft);
  margin-left: 8px;
  letter-spacing: 0;
}

.meta { font-size: 12.5px; color: var(--ink-soft); text-align: right; }

.panel {
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 14px 18px;
  padding: 16px 18px;
  margin-bottom: 18px;
}

.field { display: flex; flex-direction: column; gap: 5px; }

.field label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

.field input,
.field select {
  font: inherit;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 6px;
  padding: 7px 9px;
  min-width: 0;
}

#search { width: 220px; }
#maxPrice, #minDays, #minRating { width: 100px; }

.field.checkbox { flex-direction: row; align-items: center; gap: 7px; padding-bottom: 7px; }

.field.checkbox label {
  text-transform: none;
  font-weight: 500;
  font-size: 13px;
  letter-spacing: 0;
  color: var(--ink);
}

input[type="checkbox"] { width: 15px; height: 15px; accent-color: var(--teal); }

button { font: inherit; cursor: pointer; }

#reset {
  background: transparent;
  color: var(--rose);
  border: 1px solid var(--rule);
  border-radius: 6px;
  padding: 7px 12px;
  font-weight: 600;
  font-size: 13px;
}

#reset:hover { background: var(--teal-soft); border-color: var(--teal); color: var(--teal); }

.count { margin-left: auto; font-size: 13px; color: var(--ink-soft); align-self: center; white-space: nowrap; }
.count strong { color: var(--ink); font-weight: 700; }

.table-scroll { overflow: auto; border-radius: var(--radius); max-height: 74vh; }

table { width: 100%; border-collapse: collapse; background: var(--surface); }

thead th {
  position: sticky;
  top: 0;
  background: var(--surface);
  text-align: left;
  padding: 0;
  border-bottom: 2px solid var(--rule);
  white-space: nowrap;
  z-index: 1;
}

.th-sort {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  background: none;
  border: none;
  padding: 12px 14px;
  margin: 0;
  font: inherit;
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
  cursor: pointer;
}

.th-sort:hover { color: var(--ink); }

th[aria-sort="ascending"], th[aria-sort="descending"] { border-bottom-color: var(--teal); }
th[aria-sort="ascending"] .th-sort, th[aria-sort="descending"] .th-sort { color: var(--teal); }

.static-th {
  padding: 12px 14px;
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
}

.sort-arrow { font-size: 10px; margin-left: 2px; }

tbody td { padding: 11px 14px; border-bottom: 1px solid var(--rule); vertical-align: top; }
tbody tr:hover td { background: var(--teal-soft); }
tbody tr:last-child td { border-bottom: none; }

.price-cell {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  white-space: nowrap;
}

.price { font-weight: 700; font-size: 14.5px; }

.price-was {
  display: block;
  font-size: 12px;
  color: var(--rose);
  text-decoration: line-through;
  margin-top: 2px;
}

.days-cell {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  white-space: nowrap;
}

.destination-cell { max-width: 260px; }

.country {
  display: block;
  font-size: 12px;
  color: var(--ink-soft);
  margin-top: 2px;
}

.dates-cell { white-space: nowrap; color: var(--ink-soft); }
.tags-cell { white-space: nowrap; }

.badge {
  display: inline-block;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  padding: 3px 7px;
  border-radius: 5px;
  margin-right: 5px;
  white-space: nowrap;
}

.badge-bestseller { background: var(--amber-soft); color: var(--amber); }
.badge-breakfast { background: var(--teal-soft); color: var(--teal); }

.deal-cell { text-align: right; }

.deal-link {
  display: inline-block;
  font-weight: 600;
  font-size: 13px;
  color: var(--teal);
  text-decoration: none;
  padding: 5px 10px;
  border: 1px solid var(--teal);
  border-radius: 6px;
  white-space: nowrap;
}

.deal-link:hover { background: var(--teal); color: var(--surface); }
.deal-link-disabled { color: var(--ink-soft); border-color: var(--rule); cursor: default; }
.deal-link-disabled:hover { background: none; color: var(--ink-soft); }

.empty-row td { text-align: center; color: var(--ink-soft); padding: 40px 14px; }

footer.bottom { margin-top: 20px; font-size: 12px; color: var(--ink-soft); text-align: center; }

a { color: var(--teal); }

:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }

@media (max-width: 640px) {
  .wrap { padding: 20px 14px 48px; }
  .meta { text-align: left; }
  .count { margin-left: 0; width: 100%; }
}
`;

const CLIENT_JS = `
(function () {
  var MONTH_ORDER = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH_NAMES = {
    Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June',
    Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December'
  };

  var state = {
    search: '', month: '', country: '', minDays: 0, minRating: 0, maxPrice: null,
    breakfastOnly: false, bestsellerOnly: false,
    sortKey: 'price', sortDir: 'asc'
  };

  var els = {
    search: document.getElementById('search'),
    month: document.getElementById('month'),
    country: document.getElementById('country'),
    minDays: document.getElementById('minDays'),
    minRating: document.getElementById('minRating'),
    maxPrice: document.getElementById('maxPrice'),
    breakfastOnly: document.getElementById('breakfastOnly'),
    bestsellerOnly: document.getElementById('bestsellerOnly'),
    reset: document.getElementById('reset'),
    tbody: document.getElementById('tbody'),
    shownCount: document.getElementById('shownCount'),
    totalCount: document.getElementById('totalCount'),
    heroCountValue: document.getElementById('heroCountValue'),
    sortButtons: Array.prototype.slice.call(document.querySelectorAll('.th-sort'))
  };

  // title/destination/dates/rawText are raw scraped DOM text from a
  // third-party page, not trusted markup -- escape before touching innerHTML.
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // Defense in depth against a stray "javascript:" value ever reaching an
  // <a href> -- only ever render real http(s) links.
  function safeHref(url) {
    if (!url) return null;
    try {
      var parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch (err) {
      // malformed URL -- fall through to null
    }
    return null;
  }

  function formatPrice(n) {
    return n == null ? '\\u2014' : '\\u20AC' + n.toLocaleString('en-IE');
  }

  // "dates" has no year (e.g. "Wed, 23 Sep - Sat, 26 Sep"), so this is only an
  // approximate chronological key -- month order plus the first day-of-month
  // digits found -- not a real Date. Good enough for one scrape snapshot.
  function dateSortKey(t) {
    var dayMatch = t.dates ? t.dates.match(/(\\d{1,2})/) : null;
    var day = dayMatch ? parseInt(dayMatch[1], 10) : 99;
    var monthIdx = t.departureMonth ? MONTH_ORDER.indexOf(t.departureMonth) : 99;
    return monthIdx * 100 + day;
  }

  var SORT_ACCESSORS = {
    price: function (t) { return t.price == null ? Infinity : t.price; },
    days: function (t) { return t.days == null ? Infinity : t.days; },
    destination: function (t) { return (t.destination || '').toLowerCase(); },
    dates: dateSortKey
  };

  function populateMonthOptions() {
    var present = MONTH_ORDER.filter(function (m) {
      return TRIPS.some(function (t) { return t.departureMonth === m; });
    });
    present.forEach(function (abbr) {
      var opt = document.createElement('option');
      opt.value = abbr;
      opt.textContent = MONTH_NAMES[abbr] || abbr;
      els.month.appendChild(opt);
    });
  }

  function populateCountryOptions() {
    var present = {};
    TRIPS.forEach(function (t) {
      (t.countries || []).forEach(function (c) { present[c] = true; });
    });
    Object.keys(present).sort().forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      els.country.appendChild(opt);
    });
  }

  function applyFilters() {
    var term = state.search.trim().toLowerCase();
    return TRIPS.filter(function (t) {
      if (term) {
        var haystack = ((t.title || '') + ' ' + (t.destination || '')).toLowerCase();
        if (haystack.indexOf(term) === -1) return false;
      }
      if (state.month && t.departureMonth !== state.month) return false;
      if (state.country && (t.countries || []).indexOf(state.country) === -1) return false;
      if (state.minDays > 0 && (t.days == null ? 0 : t.days) < state.minDays) return false;
      if (state.minRating > 0) {
        var ratings = t.ratings || [];
        var worst = ratings.length ? Math.min.apply(Math, ratings) : 0;
        if (worst < state.minRating) return false;
      }
      if (state.maxPrice != null && (t.price == null ? Infinity : t.price) > state.maxPrice) return false;
      if (state.breakfastOnly && !t.breakfastIncluded) return false;
      if (state.bestsellerOnly && !t.bestseller) return false;
      return true;
    });
  }

  function sortTrips(list) {
    var accessor = SORT_ACCESSORS[state.sortKey] || SORT_ACCESSORS.price;
    var sorted = list.slice().sort(function (a, b) {
      var av = accessor(a);
      var bv = accessor(b);
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    if (state.sortDir === 'desc') sorted.reverse();
    return sorted;
  }

  function rowHtml(t) {
    var href = safeHref(t.url);
    var dealCell = href
      ? '<a class="deal-link" href="' + escapeHtml(href) + '" target="_blank" rel="noopener">View deal</a>'
      : '<span class="deal-link deal-link-disabled" aria-disabled="true">No link</span>';

    var tags =
      (t.bestseller ? '<span class="badge badge-bestseller">Bestseller</span>' : '') +
      (t.breakfastIncluded ? '<span class="badge badge-breakfast">Breakfast</span>' : '');

    var country = (t.countries && t.countries.length) ? t.countries.join(', ') : null;

    return (
      '<tr>' +
      '<td class="price-cell"><span class="price">' + escapeHtml(formatPrice(t.price)) + '</span>' +
      (t.originalPrice != null ? '<span class="price-was">' + escapeHtml(formatPrice(t.originalPrice)) + '</span>' : '') +
      '</td>' +
      '<td class="days-cell">' + (t.days != null ? escapeHtml(t.days) : '\\u2014') + '</td>' +
      '<td class="destination-cell">' + escapeHtml(t.destination || '\\u2014') +
      (country ? '<span class="country">' + escapeHtml(country) + '</span>' : '') +
      '</td>' +
      '<td class="dates-cell">' + escapeHtml(t.dates || '\\u2014') + '</td>' +
      '<td class="tags-cell">' + (tags || '<span aria-hidden="true">\\u2014</span>') + '</td>' +
      '<td class="deal-cell">' + dealCell + '</td>' +
      '</tr>'
    );
  }

  function render() {
    var filtered = applyFilters();
    var sorted = sortTrips(filtered);

    els.tbody.innerHTML = sorted.length
      ? sorted.map(rowHtml).join('')
      : '<tr class="empty-row"><td colspan="6">' +
        (TRIPS.length === 0
          ? 'No trips were found in this scrape.'
          : 'No trips match these filters \\u2014 try Reset filters.') +
        '</td></tr>';

    els.shownCount.textContent = String(filtered.length);
    els.totalCount.textContent = String(TRIPS.length);

    els.sortButtons.forEach(function (btn) {
      var th = btn.closest('th');
      var arrow = btn.querySelector('.sort-arrow');
      if (btn.dataset.sortKey === state.sortKey) {
        th.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
        arrow.textContent = state.sortDir === 'asc' ? ' \\u25B2' : ' \\u25BC';
      } else {
        th.setAttribute('aria-sort', 'none');
        arrow.textContent = '';
      }
    });
  }

  els.search.addEventListener('input', function () { state.search = els.search.value; render(); });
  els.month.addEventListener('change', function () { state.month = els.month.value; render(); });
  els.country.addEventListener('change', function () { state.country = els.country.value; render(); });
  els.minDays.addEventListener('input', function () {
    var n = parseInt(els.minDays.value, 10);
    state.minDays = isNaN(n) || n < 0 ? 0 : n;
    render();
  });
  els.minRating.addEventListener('input', function () {
    var n = parseInt(els.minRating.value, 10);
    state.minRating = isNaN(n) || n < 0 ? 0 : (n > 5 ? 5 : n);
    render();
  });
  els.maxPrice.addEventListener('input', function () {
    var n = parseInt(els.maxPrice.value, 10);
    state.maxPrice = isNaN(n) || n < 0 ? null : n;
    render();
  });
  els.breakfastOnly.addEventListener('change', function () { state.breakfastOnly = els.breakfastOnly.checked; render(); });
  els.bestsellerOnly.addEventListener('change', function () { state.bestsellerOnly = els.bestsellerOnly.checked; render(); });

  els.reset.addEventListener('click', function () {
    state.search = ''; state.month = ''; state.country = ''; state.minDays = 0; state.minRating = 0; state.maxPrice = null;
    state.breakfastOnly = false; state.bestsellerOnly = false;
    els.search.value = ''; els.month.value = ''; els.country.value = ''; els.minDays.value = ''; els.minRating.value = ''; els.maxPrice.value = '';
    els.breakfastOnly.checked = false; els.bestsellerOnly.checked = false;
    render();
  });

  els.sortButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.dataset.sortKey;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = key;
        state.sortDir = 'asc';
      }
      render();
    });
  });

  els.heroCountValue.textContent = String(TRIPS.length);
  els.totalCount.textContent = String(TRIPS.length);
  populateMonthOptions();
  populateCountryOptions();
  render();
})();
`;

function buildExplorerHtml(trips) {
  const tripsJson = serializeTripsForScript(trips);
  const generatedLabel = new Date().toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Tryp Deals Explorer</title>
<style>${CSS}</style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <div>
        <p class="eyebrow">Tryp Deals Explorer</p>
        <p class="hero-count"><span id="heroCountValue">0</span><span class="unit">trips found</span></p>
      </div>
      <p class="meta">Generated ${generatedLabel}</p>
    </header>

    <section class="panel filters" aria-label="Filters">
      <div class="field">
        <label for="search">Search</label>
        <input type="search" id="search" placeholder="Destination or title" autocomplete="off" />
      </div>
      <div class="field">
        <label for="month">Month</label>
        <select id="month"><option value="">All months</option></select>
      </div>
      <div class="field">
        <label for="country">Country</label>
        <select id="country"><option value="">All countries</option></select>
      </div>
      <div class="field">
        <label for="minDays">Min days</label>
        <input type="number" id="minDays" min="0" step="1" inputmode="numeric" placeholder="0" />
      </div>
      <div class="field">
        <label for="minRating">Min rating (★)</label>
        <input type="number" id="minRating" min="0" max="5" step="1" inputmode="numeric" placeholder="0" />
      </div>
      <div class="field">
        <label for="maxPrice">Max price (&euro;)</label>
        <input type="number" id="maxPrice" min="0" step="1" inputmode="numeric" placeholder="Any" />
      </div>
      <div class="field checkbox">
        <input type="checkbox" id="breakfastOnly" />
        <label for="breakfastOnly">Breakfast included</label>
      </div>
      <div class="field checkbox">
        <input type="checkbox" id="bestsellerOnly" />
        <label for="bestsellerOnly">Bestseller only</label>
      </div>
      <button type="button" id="reset">Reset filters</button>
      <p class="count" id="count" aria-live="polite">Showing <strong id="shownCount">0</strong> of <strong id="totalCount">0</strong> trips</p>
    </section>

    <div class="panel table-scroll">
      <table>
        <caption class="visually-hidden">Tryp holiday deals, sorted by price</caption>
        <thead>
          <tr>
            <th scope="col" aria-sort="ascending"><button type="button" class="th-sort" data-sort-key="price">Price<span class="sort-arrow" aria-hidden="true"></span></button></th>
            <th scope="col" aria-sort="none"><button type="button" class="th-sort" data-sort-key="days">Days<span class="sort-arrow" aria-hidden="true"></span></button></th>
            <th scope="col" aria-sort="none"><button type="button" class="th-sort" data-sort-key="destination">Destination<span class="sort-arrow" aria-hidden="true"></span></button></th>
            <th scope="col" aria-sort="none"><button type="button" class="th-sort" data-sort-key="dates">Dates<span class="sort-arrow" aria-hidden="true"></span></button></th>
            <th scope="col" class="static-th">Tags</th>
            <th scope="col" class="static-th deal-cell">Deal</th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>

    <footer class="bottom">tryp-loader &middot; results.json snapshot rendered locally &middot; no data leaves this page</footer>
  </div>

  <script>
    const TRIPS = ${tripsJson};
  </script>
  <script>${CLIENT_JS}</script>
</body>
</html>
`;
}

function getOpenCommand(absPath, platform = process.platform) {
  switch (platform) {
    case 'darwin':
      return { command: 'open', args: [absPath] };
    case 'win32':
      // `start` treats the first quoted arg as a window title, so an empty
      // title has to precede the target or a path with spaces gets mistaken
      // for the title instead of being opened.
      return { command: 'cmd', args: ['/c', 'start', '""', '/b', absPath] };
    default:
      return { command: 'xdg-open', args: [absPath] };
  }
}

/**
 * Opens `filePath` with the OS default handler. Best-effort: opening the
 * explorer is a convenience, not a requirement, so any failure (missing
 * xdg-open, no desktop environment, etc.) is swallowed rather than failing
 * the whole CLI run -- the file is already on disk either way.
 */
function openInBrowser(filePath) {
  const absPath = path.resolve(filePath);
  const { command, args } = getOpenCommand(absPath);

  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // spawn() can throw synchronously in rare environments; ignore for the same reason as above
  }
}

function writeAndOpenExplorer(trips, filename = 'results.html') {
  fs.writeFileSync(filename, buildExplorerHtml(trips));
  openInBrowser(filename);
  return filename;
}

module.exports = { buildExplorerHtml, openInBrowser, writeAndOpenExplorer };
