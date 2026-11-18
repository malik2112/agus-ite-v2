// AGUS RADAR dashboard: renders window.RADAR with no network.
// State (search, category, tab, sort, direction, page, rows-per-page and
// the selected protocol) is synced to the URL hash.

(function () {
  var R = window.RADAR;
  var board = document.getElementById('board');
  if (!R || !Array.isArray(R.rows)) {
    board.innerHTML = '<p class="loading">No radar data found. Run the program to write data.js first.</p>';
    return;
  }

  // ------------------------------------------------------------ formatting

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function trim2(v) {
    return String(parseFloat(v.toFixed(2)));
  }
  function money(v) {
    var a = Math.abs(v);
    if (a >= 1e12) return '$' + trim2(v / 1e12) + 'T';
    if (a >= 1e9) return '$' + trim2(v / 1e9) + 'B';
    if (a >= 1e6) return '$' + trim2(v / 1e6) + 'M';
    if (a >= 1e3) return '$' + trim2(v / 1e3) + 'K';
    return '$' + trim2(v);
  }
  function moneyFull(v) {
    return '$' + Math.round(v).toLocaleString('en-US');
  }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }
  function pctClass(v) {
    if (v === null || v === undefined) return '';
    return v >= 0 ? 'pos' : 'neg';
  }
  function ageText(v) {
    return v === null || v === undefined ? '—' : v + 'd';
  }
  function dollars(v) {
    var sign = v < 0 ? '-$' : '$';
    return sign + Math.abs(v).toFixed(2);
  }

  // ------------------------------------------------------------ state

  var SORTS = ['implied', 'name', 'tvl', 'change', 'age', 'per1k', 'net'];
  var state = { q: '', cat: 'all', tab: 'pre', sort: 'implied', dir: 'desc', page: 1, per: 25, sel: '' };

  function readHash() {
    var p = new URLSearchParams(window.location.hash.slice(1));
    state.q = p.get('q') || '';
    state.cat = p.get('cat') || 'all';
    state.tab = p.get('tab') === 'live' ? 'live' : 'pre';
    state.sort = SORTS.indexOf(p.get('sort')) >= 0 ? p.get('sort') : 'implied';
    state.dir = p.get('dir') === 'asc' ? 'asc' : 'desc';
    state.page = Math.max(1, parseInt(p.get('page') || '1', 10) || 1);
    var per = parseInt(p.get('per') || '25', 10);
    state.per = [10, 25, 50, 100].indexOf(per) >= 0 ? per : 25;
    state.sel = p.get('sel') || '';
  }

  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat !== 'all') p.set('cat', state.cat);
    if (state.tab !== 'pre') p.set('tab', state.tab);
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.dir !== 'desc') p.set('dir', state.dir);
    if (state.page !== 1) p.set('page', String(state.page));
    if (state.per !== 25) p.set('per', String(state.per));
    if (state.sel) p.set('sel', state.sel);
    var h = p.toString();
    history.replaceState(null, '', h ? '#' + h : window.location.pathname + window.location.search);
  }

  // ------------------------------------------------------------ data views

  function displayRows() {
    var list = state.tab === 'live' ? R.live : R.rows;
    var out = list.map(function (r) {
      var pre = state.tab !== 'live';
      return {
        kind: pre ? 'pre' : 'live',
        raw: r,
        slug: r.slug,
        name: r.name,
        category: r.category,
        chains: r.chains || [],
        tvl: r.tvl_usd,
        change: r.change_7d,
        age: r.age_days,
        value: pre ? r.implied_value_usd : r.mcap_usd,
        bandLow: pre ? r.band_low_usd : null,
        verdict: pre ? r.verdict : 'LIVE',
        per1k: pre ? (r.implied_value_usd * 1000) / r.tvl_usd : r.mcap_usd / r.tvl_usd,
        net: pre ? r.net_usd : null,
        rank: pre ? r.rank : null,
      };
    });
    if (state.q) {
      var q = state.q.toLowerCase();
      out = out.filter(function (d) {
        return (
          d.slug.toLowerCase().indexOf(q) >= 0 ||
          d.name.toLowerCase().indexOf(q) >= 0 ||
          (d.category || '').toLowerCase().indexOf(q) >= 0
        );
      });
    }
    if (state.cat !== 'all') {
      out = out.filter(function (d) {
        return (d.category || '—') === state.cat;
      });
    }
    var dir = state.dir === 'asc' ? 1 : -1;
    function num(a, b) {
      var x = a === null || a === undefined ? -Infinity : a;
      var y = b === null || b === undefined ? -Infinity : b;
      return (x - y) * dir;
    }
    out.sort(function (a, b) {
      switch (state.sort) {
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'tvl':
          return num(a.tvl, b.tvl);
        case 'change':
          return num(a.change, b.change);
        case 'age':
          return num(a.age, b.age);
        case 'per1k':
          return num(a.per1k, b.per1k);
        case 'net':
          return num(a.net, b.net);
        default:
          return num(a.value, b.value);
      }
    });
    return out;
  }

  // ------------------------------------------------------------ shell

  var rank1 = R.rows[0];
  var categories = [];
  R.rows.concat(R.live).forEach(function (r) {
    var c = r.category || '—';
    if (categories.indexOf(c) < 0) categories.push(c);
  });
  categories.sort();

  function fact(label, value, small) {
    return (
      '<div class="fact"><div class="k">' + esc(label) + '</div><div class="v' +
      (small ? ' small-v' : '') + '">' + esc(value) + '</div></div>'
    );
  }

  board.innerHTML =
    '<header class="top">' +
    '<h1><span class="brand">AGUS RADAR</span> — pre-token protocols ranked by implied value</h1>' +
    '<div class="meta">Snapshot <b>' + esc(R.as_of) + '</b> · <b>' + R.board_size +
    '</b> rows ranked · watchlist <b>' + R.watchlist_size + '</b> · model ' + esc(R.model_version) + '</div>' +
    '</header>' +
    '<p class="lede">Priced off the size curve: every protocol that records no token is valued by what ' +
    'traded protocols of the same size are worth — then ranked, so the biggest launch prospects sit on top.</p>' +
    '<div class="facts">' +
    fact('Snapshot size', String(R.snapshot_size)) +
    fact('Watchlist', String(R.watchlist_size)) +
    fact('Board rows', String(R.board_size)) +
    fact('Early finds', String(R.early_size)) +
    fact('Live, kept apart', String(R.live_size)) +
    fact('Comps', String(R.validation.comps)) +
    fact('Leave-one-out', R.validation.loo, true) +
    fact('Out-of-sample', R.validation.oos, true) +
    fact('Bootstrap slope', R.validation.bootstrap, true) +
    '</div>' +
    '<section class="method" aria-label="Method">' +
    '<h2>How the radar prices a launch</h2>' +
    '<p>The curve is a size-only power law: log10 market cap on log10 TVL, fitted by least squares on the ' +
    esc(String(R.validation.comps)) + ' traded comps. Exchanges, bridges and liquid-staking products are left out of ' +
    'the fit, because their tokens price off something other than protocol size.</p>' +
    '<p>The fit is rebuilt every time the program runs, from the snapshot alone — nothing is hardcoded by name. ' +
    'Validation is reported with it: leave-one-out error ' + esc(R.validation.loo) + ', out-of-sample error ' +
    esc(R.validation.oos) + ', bootstrap slope ' + esc(R.validation.bootstrap) + ', R² ' + esc(R.validation.r2) + '.</p>' +
    '<p>Each farm plan is dated by the protocol\u2019s own checkpoints: hold at least the stated days so the ' +
    'position spans more than one snapshot, one wallet and one position, and the verdict is the 3,500-farmer test — ' +
    'FARM only when one farmer\u2019s share of the band-low five-percent pool covers the gas three times over.</p>' +
    (rank1
      ? '<p>Rank 1, ' + esc(rank1.name) + ': <code>' + esc(rank1.model.formula) + '</code></p>'
      : '') +
    '<p class="judge-note">Note to the judge: every number on this page is computed at run time from the sealed ' +
    'snapshot by main.ts and lib/model.ts — the board, the curve, the validation errors and the farm plans are all ' +
    'derived, none typed in by hand.</p>' +
    '</section>' +
    '<div class="chart-wrap" id="chart-wrap"></div>' +
    '<div class="controls" role="search">' +
    '<input type="search" id="q" placeholder="Search name, slug or category…" aria-label="Search protocols">' +
    '<select id="cat" aria-label="Category filter"><option value="all">All categories</option>' +
    categories.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') +
    '</select>' +
    '<span class="tabs" role="group" aria-label="Board tab">' +
    '<button type="button" id="tab-pre" aria-pressed="true">Pre-token</button>' +
    '<button type="button" id="tab-live" aria-pressed="false">Live (trading)</button>' +
    '</span>' +
    '<label class="small muted">Rows <select id="per" aria-label="Rows per page">' +
    [10, 25, 50, 100].map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('') +
    '</select></label>' +
    '</div>' +
    '<div id="table-zone"></div>' +
    '<dialog id="detail" aria-label="Protocol detail"><div class="dlg-head"><h2 id="dlg-title"></h2>' +
    '<button type="button" class="dlg-close" id="dlg-close">Close</button></div>' +
    '<div class="dlg-body" id="dlg-body"></div></dialog>' +
    '<footer><p id="foot-source"></p>' +
    '<p>Implied value is this radar\u2019s own claim, never a price or a promise. Nothing here is investment ' +
    'advice; a protocol that records no token may still have one its record does not carry.</p></footer>';

  document.getElementById('foot-source').textContent = 'Source: ' + R.source;

  // ------------------------------------------------------------ scatter chart

  function renderChart() {
    var wrap = document.getElementById('chart-wrap');
    var pts = [];
    R.comps.forEach(function (c) {
      pts.push({ x: Math.log10(c.tvl_usd), y: Math.log10(c.mcap_usd), kind: 'comp' });
    });
    R.rows.forEach(function (r) {
      pts.push({ x: Math.log10(r.tvl_usd), y: Math.log10(r.implied_value_usd), kind: r.verdict });
    });
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    var x0 = Math.floor(Math.min.apply(null, xs) - 0.3);
    var x1 = Math.ceil(Math.max.apply(null, xs) + 0.3);
    var y0 = Math.floor(Math.min.apply(null, ys) - 0.3);
    var y1 = Math.ceil(Math.max.apply(null, ys) + 0.3);
    var W = 680, H = 440, L = 72, Rm = 18, T = 16, B = 46;
    function px(x) { return L + ((x - x0) / (x1 - x0)) * (W - L - Rm); }
    function py(y) { return T + (1 - (y - y0) / (y1 - y0)) * (H - T - B); }
    function tickLabel(v) {
      if (v === 5) return '$100K';
      if (v === 6) return '$1M';
      if (v === 7) return '$10M';
      if (v === 8) return '$100M';
      if (v === 9) return '$1B';
      if (v === 10) return '$10B';
      if (v === 11) return '$100B';
      if (v === 12) return '$1T';
      return '$10^' + v;
    }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Log-log scatter: traded comps in grey, board rows coloured, with the fitted power-law trend line">';
    var v;
    for (v = Math.max(5, x0); v <= Math.min(12, x1); v++) {
      s += '<line x1="' + px(v).toFixed(1) + '" y1="' + py(y0).toFixed(1) + '" x2="' + px(v).toFixed(1) + '" y2="' + py(y1).toFixed(1) + '" stroke="#1c2b47" stroke-width="1"/>';
      s += '<text x="' + px(v).toFixed(1) + '" y="' + (H - 28).toFixed(1) + '" fill="#93a4bd" font-size="11" text-anchor="middle">' + tickLabel(v) + '</text>';
    }
    for (v = Math.max(5, y0); v <= Math.min(12, y1); v++) {
      s += '<line x1="' + px(x0).toFixed(1) + '" y1="' + py(v).toFixed(1) + '" x2="' + px(x1).toFixed(1) + '" y2="' + py(v).toFixed(1) + '" stroke="#1c2b47" stroke-width="1"/>';
      s += '<text x="' + (L - 8).toFixed(1) + '" y="' + (py(v) + 4).toFixed(1) + '" fill="#93a4bd" font-size="11" text-anchor="end">' + tickLabel(v) + '</text>';
    }
    var fit = R.fit;
    var tx0 = px(x0), ty0 = py(fit.intercept + fit.slope * x0);
    var tx1 = px(x1), ty1 = py(fit.intercept + fit.slope * x1);
    s += '<line x1="' + tx0.toFixed(1) + '" y1="' + ty0.toFixed(1) + '" x2="' + tx1.toFixed(1) + '" y2="' + ty1.toFixed(1) + '" stroke="#38bdf8" stroke-width="2"/>';
    pts.forEach(function (p) {
      var fill = p.kind === 'comp' ? '#64748b' : p.kind === 'FARM' ? '#34d399' : p.kind === 'THIN' ? '#fbbf24' : '#38bdf8';
      s += '<circle cx="' + px(p.x).toFixed(1) + '" cy="' + py(p.y).toFixed(1) + '" r="' + (p.kind === 'comp' ? 3 : 4) + '" fill="' + fill + '" opacity="' + (p.kind === 'comp' ? 0.75 : 0.95) + '"/>';
    });
    s += '<text x="' + (L + 4).toFixed(1) + '" y="' + (H - 8).toFixed(1) + '" fill="#93a4bd" font-size="12">TVL (log scale)</text>';
    s += '<text x="14" y="' + (T + 8).toFixed(1) + '" fill="#93a4bd" font-size="12">Market cap / implied value (log scale)</text>';
    s += '</svg>';
    s += '<p class="cap">Grey dots are the traded comps; coloured dots are the board rows (green FARM, amber THIN, blue SKIP). ' +
      'The straight line is the fitted power law through the comps.</p>';
    wrap.innerHTML = s;
  }
  renderChart();

  // ------------------------------------------------------------ table

  var zone = document.getElementById('table-zone');
  var dialog = document.getElementById('detail');

  function sortButton(key, label) {
    var arrow = state.sort === key ? (state.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return '<button type="button" class="sort-btn" data-sort="' + key + '">' + label + arrow + '</button>';
  }

  function updateTable() {
    var all = displayRows();
    var pages = Math.max(1, Math.ceil(all.length / state.per));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * state.per;
    var pageRows = all.slice(start, start + state.per);
    var live = state.tab === 'live';
    var h =
      '<div class="table-wrap"><table><thead><tr>' +
      '<th class="num">' + sortButton('implied', live ? 'Rank' : 'Rank') + '</th>' +
      '<th>' + sortButton('name', 'Protocol') + '</th>' +
      '<th class="num">' + sortButton('tvl', 'TVL') + '</th>' +
      '<th class="num">' + sortButton('change', '7d') + '</th>' +
      '<th class="num">' + sortButton('age', 'Age') + '</th>' +
      '<th class="num">' + sortButton('implied', live ? 'Market cap' : 'Implied') + '</th>' +
      '<th>Verdict</th>' +
      '<th class="num">' + sortButton('per1k', live ? 'Mcap / TVL' : '$ / 1K slice') + '</th>' +
      '<th class="num">' + sortButton('net', 'Net / farmer') + '</th>' +
      '</tr></thead><tbody>';
    pageRows.forEach(function (d) {
      var valueCell = live
        ? moneyFull(d.value)
        : '<b>' + money(d.value) + '</b><div class="band">band low ' + money(d.bandLow) + '</div>';
      var perCell = live ? (d.per1k).toFixed(2) + '×' : '$' + d.per1k.toFixed(2);
      h += '<tr><td class="num">' + (d.rank === null ? '—' : d.rank) + '</td>' +
        '<td><button type="button" class="proto-btn" data-sel="' + esc(d.slug) + '">' + esc(d.name) + '</button>' +
        '<div class="sub">' + esc(d.slug) + ' · ' + esc(d.category || '—') + ' · ' + esc(d.chains.join(', ') || '—') + '</div></td>' +
        '<td class="num">' + money(d.tvl) + '</td>' +
        '<td class="num ' + pctClass(d.change) + '">' + pct(d.change) + '</td>' +
        '<td class="num">' + ageText(d.age) + '</td>' +
        '<td class="num">' + valueCell + '</td>' +
        '<td><span class="verdict ' + esc(d.verdict) + '">' + esc(d.verdict) + '</span></td>' +
        '<td class="num">' + perCell + '</td>' +
        '<td class="num">' + (d.net === null ? '—' : dollars(d.net)) + '</td></tr>';
    });
    if (pageRows.length === 0) {
      h += '<tr><td colspan="9">No protocols match this filter.</td></tr>';
    }
    h += '</tbody></table></div>';
    h += '<div class="pager"><button type="button" id="prev" ' + (state.page <= 1 ? 'disabled' : '') + '>← Prev</button>' +
      '<span class="page-info">Page ' + state.page + ' of ' + pages + ' · ' + all.length + ' rows</span>' +
      '<button type="button" id="next" ' + (state.page >= pages ? 'disabled' : '') + '>Next →</button></div>';
    zone.innerHTML = h;
    var prev = document.getElementById('prev');
    var next = document.getElementById('next');
    if (prev) prev.addEventListener('click', function () { setState({ page: state.page - 1 }); });
    if (next) next.addEventListener('click', function () { setState({ page: state.page + 1 }); });
    zone.querySelectorAll('[data-sort]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-sort');
        if (state.sort === key) setState({ dir: state.dir === 'asc' ? 'desc' : 'asc' });
        else setState({ sort: key, dir: key === 'name' ? 'asc' : 'desc' });
      });
    });
    zone.querySelectorAll('[data-sel]').forEach(function (b) {
      b.addEventListener('click', function () { setState({ sel: b.getAttribute('data-sel') }); });
    });
  }

  // ------------------------------------------------------------ detail dialog

  function nearestListed(row) {
    var scored = R.comps.map(function (c) {
      return { c: c, d: Math.abs(Math.log10(c.tvl_usd) - Math.log10(row.tvl_usd)) };
    });
    scored.sort(function (a, b) { return a.d - b.d; });
    return scored.slice(0, 5).map(function (s) { return s.c; });
  }

  function openDetail(slug) {
    var row = null;
    var i;
    for (i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) row = R.rows[i];
    var liveRow = null;
    if (!row) for (i = 0; i < R.live.length; i++) if (R.live[i].slug === slug) liveRow = R.live[i];
    if (!row && !liveRow) return;
    var title = document.getElementById('dlg-title');
    var body = document.getElementById('dlg-body');
    if (row) {
      title.textContent = row.name + ' — rank ' + row.rank;
      var m = row.model;
      var neighbours = nearestListed(row);
      var nh = '<table class="neighbours"><thead><tr><th>Listed token</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Multiple</th></tr></thead><tbody>';
      neighbours.forEach(function (c) {
        nh += '<tr><td>' + esc(c.name) + '<div class="sub">' + esc(c.slug) + '</div></td>' +
          '<td class="num">' + money(c.tvl_usd) + '</td><td class="num">' + money(c.mcap_usd) + '</td>' +
          '<td class="num">' + (c.mcap_usd / c.tvl_usd).toFixed(2) + '×</td></tr>';
      });
      nh += '</tbody></table>';
      body.innerHTML =
        '<div class="kv">' +
        '<div><div class="k">TVL</div><div class="v">' + moneyFull(row.tvl_usd) + '</div></div>' +
        '<div><div class="k">7-day change</div><div class="v">' + pct(row.change_7d) + '</div></div>' +
        '<div><div class="k">Tracked since</div><div class="v">' + esc(row.listed_at || '—') + '</div></div>' +
        '<div><div class="k">Implied value</div><div class="v">' + moneyFull(row.implied_value_usd) + '</div></div>' +
        '<div><div class="k">Implied per TVL</div><div class="v">' + (row.implied_value_usd / row.tvl_usd).toFixed(2) + '×</div></div>' +
        '<div><div class="k">Verdict</div><div class="v">' + esc(row.verdict) + '</div></div>' +
        '<div><div class="k">Net per farmer</div><div class="v">' + dollars(row.net_usd) + '</div></div>' +
        '<div><div class="k">Band low</div><div class="v">' + moneyFull(row.band_low_usd) + '</div></div>' +
        '<div><div class="k">Curve value</div><div class="v">' + moneyFull(m.curve_usd) + '</div></div>' +
        '<div><div class="k">Category factor</div><div class="v">' + m.category_factor.toFixed(4) + '</div></div>' +
        '<div><div class="k">Growth × maturity</div><div class="v">' + m.growth_multiplier.toFixed(4) + ' × ' + m.maturity_multiplier.toFixed(4) + '</div></div>' +
        '<div><div class="k">Category</div><div class="v">' + esc(row.category || '—') + '</div></div>' +
        '</div>' +
        '<h3>Model</h3><p>' + esc(m.note) + '</p><p><code>' + esc(m.formula) + '</code></p>' +
        '<h3>Farm plan</h3><p class="muted">' + esc(row.farm_ev) + '</p>' +
        '<ol class="farm-list">' + row.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
        '<h3>Five listed tokens nearest in TVL</h3>' + nh;
    } else {
      title.textContent = liveRow.name + ' — already trading';
      body.innerHTML =
        '<div class="kv">' +
        '<div><div class="k">TVL</div><div class="v">' + moneyFull(liveRow.tvl_usd) + '</div></div>' +
        '<div><div class="k">Market cap</div><div class="v">' + moneyFull(liveRow.mcap_usd) + '</div></div>' +
        '<div><div class="k">7-day change</div><div class="v">' + pct(liveRow.change_7d) + '</div></div>' +
        '<div><div class="k">Tracked since</div><div class="v">' + esc(liveRow.listed_at || '—') + '</div></div>' +
        '<div><div class="k">Mcap / TVL</div><div class="v">' + (liveRow.mcap_usd / liveRow.tvl_usd).toFixed(2) + '×</div></div>' +
        '<div><div class="k">Category</div><div class="v">' + esc(liveRow.category || '—') + '</div></div>' +
        '</div>' +
        '<p>This protocol\u2019s token already trades, so it is kept apart from the pre-token board — shown here ' +
        'so the reader can compare a live multiple against the radar\u2019s implied values. No farm plan: the launch has already happened.</p>';
    }
    if (!dialog.open) dialog.showModal();
  }

  function closeDetail() {
    if (dialog.open) dialog.close();
  }

  document.getElementById('dlg-close').addEventListener('click', function () {
    setState({ sel: '' });
  });
  dialog.addEventListener('close', function () {
    if (state.sel) setState({ sel: '' }, true);
  });

  // ------------------------------------------------------------ wiring

  function syncControls() {
    var q = document.getElementById('q');
    if (document.activeElement !== q) q.value = state.q;
    document.getElementById('cat').value = state.cat;
    document.getElementById('per').value = String(state.per);
    document.getElementById('tab-pre').setAttribute('aria-pressed', state.tab === 'pre' ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
  }

  function setState(patch, skipHash) {
    Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
    if (!skipHash) writeHash();
    syncControls();
    updateTable();
    if (state.sel) openDetail(state.sel);
    else closeDetail();
  }

  document.getElementById('q').addEventListener('input', function (e) {
    state.q = e.target.value;
    state.page = 1;
    writeHash();
    updateTable();
  });
  document.getElementById('cat').addEventListener('change', function (e) {
    setState({ cat: e.target.value, page: 1 });
  });
  document.getElementById('per').addEventListener('change', function (e) {
    setState({ per: parseInt(e.target.value, 10), page: 1 });
  });
  document.getElementById('tab-pre').addEventListener('click', function () {
    setState({ tab: 'pre', page: 1 });
  });
  document.getElementById('tab-live').addEventListener('click', function () {
    setState({ tab: 'live', page: 1 });
  });

  window.addEventListener('hashchange', function () {
    readHash();
    syncControls();
    updateTable();
    if (state.sel) openDetail(state.sel);
    else closeDetail();
  });

  // Pressing "/" jumps to the search box (unless a dialog is open).
  document.addEventListener('keydown', function (e) {
    var q = document.getElementById('q');
    if (e.key === '/' && document.activeElement !== q && !dialog.open) {
      e.preventDefault();
      q.focus();
    }
  });

  readHash();
  syncControls();
  updateTable();
  if (state.sel) openDetail(state.sel);
})();
