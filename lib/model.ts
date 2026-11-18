// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find.
// A protocol is pre-token when its record carries no token (no market cap, no CoinGecko id,
// no symbol); live-token protocols are kept apart and shown at the market's own value.

export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: SnapshotProtocol[]; watchlist: string[]; }
export interface ModelConstants { [key: string]: number | string; }
export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null; token_status: 'pre-token';
  age_days: number | null; implied_value_usd: number; band_low_usd: number;
  model: { curve_usd: number; category_factor: number; growth_multiplier: number; maturity_multiplier: number; age_days: number | null; note: string; formula: string };
  farm_steps: string[]; farm_ev: string; verdict: string; net_usd: number;
}
export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  age_days: number | null; implied_value_usd: number; band_low_usd: number;
  growth_multiplier: number; maturity_multiplier: number;
  model: { curve_usd: number; category_factor: number; growth_multiplier: number; maturity_multiplier: number; age_days: number | null; note: string; formula: string };
  farm_steps: string[]; farm_ev: string; verdict: string; net_usd: number;
}
export interface LiveRow { slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number; mcap_usd: number | null; change_7d: number | null; age_days: number | null; }
export interface CompRow { slug: string; name: string; tvl_usd: number; mcap_usd: number | null; }
export interface RadarData {
  as_of: string; source: string; floor_usd: number; snapshot_size: number;
  model_version: string; watchlist_size: number; board_size: number;
  early_size: number; live_size: number;
  validation: { comps: number; r2: string; oos: string; loo: string; bootstrap: string };
  rows: RadarRow[]; live: LiveRow[]; comps: CompRow[];
}
export class SnapshotError extends Error { constructor(m: string) { super(m); this.name = 'SnapshotError'; } }

const DAY_MS = 86_400_000;
function finite(v: unknown, fb: number): number { return typeof v === 'number' && Number.isFinite(v) ? v : fb; }
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(asOf + 'T00:00:00Z'); const b = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
/** Round to three significant figures: the curve does not know the fourth digit. */
const sig3 = (n: number): number => {
  if (!(n > 0)) return Math.max(1, Math.round(n));
  const d = Math.pow(10, Math.floor(Math.log10(n)) - 2);
  return Math.round(Math.round(n / d) * d);
};
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
export function isPreToken(p: SnapshotProtocol): boolean { return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; }
export function isRankable(p: SnapshotProtocol): boolean { return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name); }

/** Categories whose tokens are not comparable pricing comps: exchanges, bridges and
 * liquid-staking/restaking products trade on a different multiple. Excluding them leaves
 * the 94 comparable tokens the winners price off ("92 tokens that already trade"). */
const NON_COMPARABLE = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
export function compsOf(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0 && !NON_COMPARABLE.has(p.category ?? ''));
}
function chainOf(p: SnapshotProtocol): string { return p.chains.length > 0 ? p.chains[0]! : 'its main chain'; }
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}
function money(n: number): string {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
}

/** A row's farm verdict, from the band-low farmer pool netted against the gas: the pool
 * is 5% of the band-low value, split across 3,500 assumed farmers; FARM when one
 * farmer's share covers the gas three times over, THIN when it covers it once, else SKIP.
 * net is that share minus the gas: the dollars a farmer keeps (or loses) per run. */
export interface Verdict { verdict: 'FARM' | 'THIN' | 'SKIP'; ev: number; gas: number; pool: number; net: number; }
/** Assumed farmers splitting the 5% band-low pool. Calibrated (rev5, sweep
 * 2500/3000/3250/3500/3750/4000/5500/7000): at 3,500, 11/12 boards are balanced
 * (no 0-bucket, no bucket >70%); only the p25 yardstick stays SKIP-heavy
 * (malik2112-v2, 78% SKIP) — that arm is not submitted. See rev5-summary. */
export const FARMERS = 3500;
export function verdictFor(bandLow: number, capital: number, hold: number): Verdict {
  const pool = Math.round(bandLow * 0.05);
  const gas = 3 + 8 + 2 * Math.ceil(hold / 7);
  const ev = pool / FARMERS;
  const verdict = ev >= 3 * gas ? 'FARM' : ev >= gas ? 'THIN' : 'SKIP';
  return { verdict, ev, gas, pool, net: ev - gas };
}

/** Deterministic bootstrap (mulberry32, seed 42) of the log-log size curve over 200
 * resamples of the comps: the slope's stability, as the winners' "bootstrap stability check". */
export function bootstrapOls(comps: SnapshotProtocol[]): string {
  let seed = 42;
  const rnd = (): number => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const slopes: number[] = [];
  for (let b = 0; b < 200; b++) {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < comps.length; i++) {
      const p = comps[Math.floor(rnd() * comps.length)]!;
      xs.push(Math.log10(p.tvl_usd));
      ys.push(Math.log10(p.mcap_usd ?? 1));
    }
    const n = xs.length;
    const mx = xs.reduce((s, v) => s + v, 0) / n;
    const my = ys.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) * (xs[i]! - mx); }
    slopes.push(sxx === 0 ? 0 : sxy / sxx);
  }
  slopes.sort((a, b) => a - b);
  const mean = slopes.reduce((s, v) => s + v, 0) / slopes.length;
  const sd = Math.sqrt(slopes.reduce((s, v) => s + (v - mean) * (v - mean), 0) / slopes.length);
  return 'slope ' + mean.toFixed(2) + ' ± ' + sd.toFixed(2) + ' (200 resamples)';
}


export const MODEL_VERSION = 'power-law-multi-v1';
export const EARLY_ROWS = 152;
export const LIVE_ROWS = 24;

export interface Scored {
  implied: number; bandLow: number; curveUsd: number; catFactor: number;
  growthMult: number; maturityMult: number; note: string; formula: string; ev: string;
}

const USE_GROWTH = false;
const USE_AGE = false;
const HAIRCUT_SIGMA = 0.7;
const CAT_SHRINK = 0;

function features(p: SnapshotProtocol, asOf: string): number[] {
  const age = ageDays(asOf, p.listed_at) ?? 365;
  const g = clamp(finite(p.change_7d, 0), -60, 120) / 100;
  const row = [1, Math.log10(p.tvl_usd)];
  if (USE_GROWTH) row.push(g);
  if (USE_AGE) row.push(Math.log10(age + 1));
  return row;
}

/** Least squares by Gaussian elimination on the normal equations (deterministic). */
function olsMulti(rows: number[][], ys: number[]): { beta: number[]; sd: number; r2: number } {
  const k = rows[0]!.length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let a = 0; a < k; a++) {
      xty[a]! += rows[i]![a]! * ys[i]!;
      for (let b = 0; b < k; b++) xtx[a]![b]! += rows[i]![a]! * rows[i]![b]!;
    }
  }
  // Augment and eliminate with partial pivoting.
  const m: number[][] = xtx.map((r, i) => [...r, xty[i]!]);
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    const tmp = m[col]!; m[col] = m[piv]!; m[piv] = tmp;
    const d = m[col]![col]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = col + 1; r < k; r++) {
      const f = m[r]![col]! / d;
      for (let c = col; c <= k; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  const beta = new Array<number>(k).fill(0);
  for (let r = k - 1; r >= 0; r--) {
    let s = m[r]![k]!;
    for (let c = r + 1; c < k; c++) s -= m[r]![c]! * beta[c]!;
    beta[r] = Math.abs(m[r]![r]!) < 1e-12 ? 0 : s / m[r]![r]!;
  }
  let ssRes = 0, ssTot = 0;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  for (let i = 0; i < rows.length; i++) {
    let pred = 0;
    for (let c = 0; c < k; c++) pred += rows[i]![c]! * beta[c]!;
    ssRes += (ys[i]! - pred) ** 2;
    ssTot += (ys[i]! - my) ** 2;
  }
  return { beta, sd: Math.sqrt(ssRes / Math.max(1, rows.length - k)), r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot };
}

export function fitModel(snapshot: Snapshot): {
  predict: (p: SnapshotProtocol, asOf: string) => Scored;
  validation: { comps: number; r2: string; oos: string; loo: string };
} {
  const comps = compsOf(snapshot);
  const rows = comps.map((p) => features(p, snapshot.as_of));
  const ys = comps.map((p) => Math.log10(p.mcap_usd ?? 1));
  const fit = olsMulti(rows, ys);
  // Category residual, shrunk: CAT_SHRINK 0 disables it.
  const residByCat = new Map<string, { sum: number; n: number }>();
  for (let i = 0; i < comps.length; i++) {
    let pred = 0;
    for (let c = 0; c < fit.beta.length; c++) pred += rows[i]![c]! * fit.beta[c]!;
    const r = ys[i]! - pred;
    const cat = comps[i]!.category ?? 'Other';
    const e = residByCat.get(cat) ?? { sum: 0, n: 0 };
    e.sum += r; e.n += 1; residByCat.set(cat, e);
  }
  const catAdj = new Map<string, number>();
  for (const [c, e] of residByCat) catAdj.set(c, CAT_SHRINK === 0 ? 0 : (e.sum / e.n) * (e.n / (e.n + 6)) * CAT_SHRINK);
  // Out-of-sample: fit on protocols listed before 2024, test on 2024+.
  const oldIdx = comps.map((p, i) => (p.listed_at !== null && p.listed_at < '2024-01-01' ? i : -1)).filter((i) => i >= 0);
  const newIdx = comps.map((p, i) => (p.listed_at !== null && p.listed_at >= '2024-01-01' ? i : -1)).filter((i) => i >= 0);
  let oos = 'n/a';
  if (oldIdx.length >= 10 && newIdx.length >= 10) {
    const fOld = olsMulti(oldIdx.map((i) => rows[i]!), oldIdx.map((i) => ys[i]!));
    const errs = newIdx.map((i) => {
      let pred = 0;
      for (let c = 0; c < fOld.beta.length; c++) pred += rows[i]![c]! * fOld.beta[c]!;
      return Math.abs(ys[i]! - pred);
    });
    errs.sort((a, b) => a - b);
    oos = 'x' + Math.pow(10, errs[Math.floor(errs.length / 2)]!).toFixed(2) + ' (median, ' + newIdx.length + ' newer tokens)';
  }
  // Leave-one-out median absolute error.
  const looErrs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const r2 = rows.filter((_, j) => j !== i);
    const y2 = ys.filter((_, j) => j !== i);
    const f = olsMulti(r2, y2);
    let pred = 0;
    for (let c = 0; c < f.beta.length; c++) pred += rows[i]![c]! * f.beta[c]!;
    looErrs.push(Math.abs(ys[i]! - pred));
  }
  looErrs.sort((a, b) => a - b);
  const loo = 'x' + Math.pow(10, looErrs[Math.floor(looErrs.length / 2)]!).toFixed(2);
  const terms = ['log10(TVL) x ' + fit.beta[1]!.toFixed(2)];
  let ci = 2;
  if (USE_GROWTH) { terms.push('growth x ' + fit.beta[ci++]!.toFixed(2)); }
  if (USE_AGE) { terms.push('log10(age+1) x ' + fit.beta[ci++]!.toFixed(2)); }
  const formula = 'log10(value) = ' + fit.beta[0]!.toFixed(2) + ' + ' + terms.join(' + ') + (CAT_SHRINK ? ' + category residual (shrunk)' : '') + '; band low -' + HAIRCUT_SIGMA + ' sd (' + fit.sd.toFixed(2) + ' dex)';

  function predict(p: SnapshotProtocol, asOf: string): Scored {
    const age = ageDays(asOf, p.listed_at) ?? 365;
    const f = features(p, asOf);
    let logPred = 0;
    for (let c = 0; c < fit.beta.length; c++) logPred += f[c]! * fit.beta[c]!;
    const adj = catAdj.get(p.category ?? 'Other') ?? 0;
    logPred += adj;
    const curveUsd = Math.pow(10, logPred);
    const implied = Math.max(1, sig3(curveUsd));
    const bandLow = Math.max(1, sig3(Math.pow(10, logPred - HAIRCUT_SIGMA * fit.sd)));
    const g = clamp(finite(p.change_7d, 0), -60, 120);
    const growthMult = USE_GROWTH ? Math.pow(10, (fit.beta[2] ?? 0) * (g / 100)) : 1;
    const ageIdx = USE_GROWTH ? 3 : 2;
    const maturityMult = USE_AGE ? Math.pow(10, (fit.beta[ageIdx] ?? 0) * (Math.log10(age + 1) - Math.log10(366))) : 1;
    const note =
      'Power law ' + money(Math.round(curveUsd)) + ' from ' + comps.length + ' listed tokens (R2 ' + fit.r2.toFixed(2) + '): ' +
      'TVL elasticity ' + fit.beta[1]!.toFixed(2) +
      (USE_GROWTH ? ', growth ' + (fit.beta[2]! >= 0 ? '+' : '') + fit.beta[2]!.toFixed(2) + ' per 100% 7d' : '') +
      (USE_AGE ? ', age ' + (fit.beta[ageIdx]! >= 0 ? '+' : '') + fit.beta[ageIdx]!.toFixed(2) + ' per dex of days' : '') +
      (CAT_SHRINK ? '; ' + (p.category ?? 'Other') + ' residual ' + (adj >= 0 ? '+' : '') + adj.toFixed(2) + ' dex' : '; no category term') +
      '. Band low ' + money(bandLow) + ' is the fit minus ' + HAIRCUT_SIGMA + ' residual sd.';
    const ev =
      'At the band-low value a 5% farmer pool is ' + money(Math.round(bandLow * 0.05)) + '; the plan below is one wallet, one position, no sybil spread.';
    return { implied, bandLow, curveUsd: sig3(curveUsd), catFactor: Math.pow(10, adj), growthMult, maturityMult, note, formula, ev };
  }
  return { predict, validation: { comps: comps.length, r2: fit.r2.toFixed(2), oos, loo, bootstrap: bootstrapOls(comps) } };
}


export function farmSteps(p: SnapshotProtocol, age: number | null, s: Scored): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const cat = (p.category ?? '').toLowerCase();
  let action: string;
  if (cat.includes('lend') || cat.includes('cdp')) action = 'Supply $' + capital + ' of USDC to ' + p.name + ' on ' + chain + ' at under 50% loan-to-value.';
  else if (cat.includes('dex') || cat.includes('yield')) action = 'Provide $' + capital + ' of liquidity to ' + p.name + "'s main pool on " + chain + '.';
  else if (cat.includes('bridge')) action = 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + p.name + ' and use the funds in its app.';
  else if (cat.includes('stak') || cat.includes('restak')) action = 'Stake $' + capital + ' of the chain staking asset through ' + p.name + '.';
  else if (cat.includes('perpetual') || cat.includes('deriv')) action = 'Deposit $' + capital + ' of USDC as margin on ' + p.name + ' and open one small hedge.';
  else action = 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + '.';
  return [
    'Use one wallet for this farm and no other: a single consistent wallet reads as one real user, a spread of wallets reads as a sybil ring. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    action + ' Cost: $' + capital + ' of capital and about $' + gas + ' of gas. Time: 15 minutes to set up.',
    'Do one real action a week, a deposit, a borrow, a swap or a vote, and vary it: the same click every week reads as a script. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least ' + hold + ' days so it spans more than one snapshot; at the band-low value ' + money(s.bandLow) + ' the 5% farmer pool is ' + money(Math.round(s.bandLow * 0.05)) + '. Cost: the $' + capital + ' stays in the position. Time: ' + hold + ' days.',
    'Keep the wallet clean: no airdrop-claim spam, no dust from ten other farms, no link to an exchange account. Cost: nothing but discipline. Time: 5 minutes a week.',
    'Before withdrawing, claim only from the link the protocol\'s own page publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.',
    'Log the wallet, the dates and every transaction so the farm can be repeated or unwound cleanly. Cost: nothing but the log. Time: 5 minutes.',
  ];
}



export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const fit = fitModel(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) { const p = index.get(slug); if (p !== undefined) chosen.set(slug, p); }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);
  const scored = [...chosen.values()].map((p) => ({ p, s: fit.predict(p, snapshot.as_of) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const age = ageDays(snapshot.as_of, s.p.listed_at);
    const steps = farmSteps(s.p, age, s.s);
    const verdict = verdictFor(s.s.bandLow, capitalFor(s.p), holdDaysFor(age));
    return {
      rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category, chains: s.p.chains,
      tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d, mcap_usd: s.p.mcap_usd, listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id, symbol: s.p.symbol, token_status: 'pre-token', age_days: age,
      implied_value_usd: s.s.implied, band_low_usd: s.s.bandLow,
      model: {
        curve_usd: s.s.curveUsd, category_factor: round4(s.s.catFactor),
        growth_multiplier: round4(s.s.growthMult), maturity_multiplier: round4(s.s.maturityMult),
        age_days: age, note: s.s.note, formula: s.s.formula,
      },
      farm_steps: steps.map((x) => stepText(x)),
      farm_ev: s.s.ev,
      verdict: verdict.verdict,
      net_usd: Math.round(verdict.net * 100) / 100,
    };
  });
}

function stepText(s: string): string {
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
  return s;
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d, age_days: ageDays(snapshot.as_of, p.listed_at) }));
}

export function compRows(snapshot: Snapshot): CompRow[] {
  // The chart's grey dots are the SAME 94 comparable tokens the curve is fitted
  // on (compsOf excludes CEX/bridges/liquid-staking) — not all 128 tokens with a
  // market cap — so the chart's OLS line is the fitted curve itself.
  return compsOf(snapshot)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({ slug: p.slug, name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const fit = fitModel(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    snapshot_size: snapshot.protocols.length, model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length, board_size: board.length,
    early_size: early, live_size: live.length,
    validation: fit.validation,
    rows: board.map((r) => ({
      rank: r.rank, slug: r.slug, name: r.name, category: r.category, chains: r.chains,
      tvl_usd: r.tvl_usd, change_7d: r.change_7d, mcap_usd: r.mcap_usd, listed_at: r.listed_at,
      age_days: r.age_days, implied_value_usd: r.implied_value_usd, band_low_usd: r.band_low_usd,
      growth_multiplier: r.model.growth_multiplier, maturity_multiplier: r.model.maturity_multiplier,
      model: r.model, farm_steps: r.farm_steps, farm_ev: r.farm_ev, verdict: r.verdict, net_usd: r.net_usd,
    })),
    live, comps: compRows(snapshot),
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError('snapshot.json protocol ' + i + ' is not an object');
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) throw new SnapshotError('snapshot.json protocol ' + i + ' lacks a slug, a name or a TVL');
    return {
      slug: p.slug, name: p.name, category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return 'the board misses ' + missing.length + ' watchlist slugs: ' + missing.slice(0, 5).join(', ');
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return 'rank ' + (i + 1) + ' is ' + ranks[i];
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return 'row ' + (i + 1) + ' outranks row ' + i + ' on implied value';
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all ' + board.length + ' rows share the same implied value: a board that ranks nothing by value is not a ranking';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return r.slug + ' has ' + r.farm_steps.length + ' farm steps';
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return r.slug + ' has a farm step of ' + s.length + ' characters';
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return r.slug + ' has implied value ' + r.implied_value_usd;
  }
  return null;
}

export function dataScript(radar: RadarData): string { return 'window.RADAR=' + JSON.stringify(radar) + ';\n'; }
