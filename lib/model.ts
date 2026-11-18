// AGUS RADAR — token launch radar (power-law-multi-v1)
//
// One sealed snapshot of the protocol universe in, one ranked board out.
// The value model is a size-only power law: a single log-log regression of
// market cap on TVL over the traded comps. Growth and age inputs are
// computed by the feature builder but deliberately switched OFF, and the
// category shrink is 0, so the fitted curve uses TVL alone.

export const MODEL_VERSION = 'power-law-multi-v1';
export const EARLY_COUNT = 152;
export const LIVE_COUNT = 24;
export const FARMERS = 3500;
export const POOL_SHARE = 0.05;
export const BAND_SD = 0.7;
export const USE_GROWTH = false;
export const USE_AGE = false;
export const CAT_SHRINK = 0;
export const BOOTSTRAP_SEED = 42;
export const BOOTSTRAP_RESAMPLES = 200;
export const OOS_CUTOFF = '2024-01-01';

const EXCLUDED_COMP_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

// A name ending in a version marker: a space followed by V1, v2, 1.2 or similar.
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------------ types

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface Fit {
  intercept: number;
  slope: number;
  residualSd: number;
  rSquared: number;
  n: number;
  categoryAdjustment: Map<string, number>;
}

export interface Validation {
  comps: number;
  r2: string;
  oos: string;
  loo: string;
  bootstrap: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  pre_token: boolean;
  age_days: number | null;
  implied_value_usd: number;
  band_low_usd: number;
  model: {
    curve_usd: number;
    category_factor: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    note: string;
    formula: string;
  };
  farm_steps: string[];
  farm_ev: string;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  net_usd: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  age_days: number | null;
}

export interface CompRow {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  snapshot_size: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  fit: { intercept: number; slope: number; residual_sd: number; r_squared: number };
  validation: Validation;
  rows: BoardRow[];
  live: LiveRow[];
  comps: CompRow[];
}

// ------------------------------------------------------------------ helpers

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseDate(value: string): Date | null {
  if (!DATE_RE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

/** Whole days from listed_at to as_of, minimum 0; null when unknown. */
export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const listed = parseDate(listedAt);
  const asOfDate = parseDate(asOf);
  if (listed === null || asOfDate === null) return null;
  const days = Math.floor((asOfDate.getTime() - listed.getTime()) / 86400000);
  return Math.max(0, days);
}

/** Three significant figures, minimum 1. */
export function round3Sig(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v)) - 2;
  const f = 10 ** exp;
  return Math.max(1, Math.round(v / f) * f);
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function trim2(v: number): string {
  return String(parseFloat(v.toFixed(2)));
}

export function formatMoney(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e12) return `$${trim2(v / 1e12)}T`;
  if (a >= 1e9) return `$${trim2(v / 1e9)}B`;
  if (a >= 1e6) return `$${trim2(v / 1e6)}M`;
  if (a >= 1e3) return `$${trim2(v / 1e3)}K`;
  return `$${trim2(v)}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Deterministic PRNG (mulberry32) for the bootstrap. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Upper median: the sorted element at floor(n / 2). */
function medianUpper(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ------------------------------------------------------------------ snapshot

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`snapshot is not valid JSON: ${(err as Error).message}`);
  }
  if (!isRecord(raw)) throw new Error('snapshot is not a JSON object');
  if (typeof raw.as_of !== 'string' || parseDate(raw.as_of) === null) {
    throw new Error('snapshot as_of is missing or not a YYYY-MM-DD date');
  }
  if (typeof raw.source !== 'string' || raw.source.length === 0) {
    throw new Error('snapshot source is missing');
  }
  if (typeof raw.floor_usd !== 'number' || !Number.isSafeInteger(raw.floor_usd) || raw.floor_usd <= 0) {
    throw new Error('snapshot floor_usd is not a positive safe integer');
  }
  if (!Array.isArray(raw.protocols)) throw new Error('snapshot protocols is not an array');
  if (!Array.isArray(raw.watchlist) || raw.watchlist.some((s) => typeof s !== 'string')) {
    throw new Error('snapshot watchlist is not an array of strings');
  }
  const protocols: SnapshotProtocol[] = raw.protocols.map((p, i) => {
    if (!isRecord(p)) throw new Error(`snapshot protocols[${i}] is not an object`);
    if (typeof p.slug !== 'string' || p.slug.length === 0) {
      throw new Error(`snapshot protocols[${i}] is missing slug`);
    }
    if (typeof p.name !== 'string' || p.name.length === 0) {
      throw new Error(`snapshot protocols[${i}] is missing name`);
    }
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new Error(`snapshot protocols[${i}] is missing a finite tvl_usd`);
    }
    const numOrNull = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: numOrNull(p.change_7d),
      mcap_usd: numOrNull(p.mcap_usd),
      listed_at: strOrNull(p.listed_at),
      gecko_id: strOrNull(p.gecko_id),
      symbol: strOrNull(p.symbol),
    };
  });
  return {
    as_of: raw.as_of,
    source: raw.source,
    floor_usd: raw.floor_usd,
    protocols,
    watchlist: [...(raw.watchlist as string[])],
  };
}

// ------------------------------------------------------------------ model

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSION_SUFFIX.test(p.name);
}

export function isComp(p: SnapshotProtocol): boolean {
  return (
    typeof p.mcap_usd === 'number' &&
    p.mcap_usd > 0 &&
    p.tvl_usd > 0 &&
    !EXCLUDED_COMP_CATEGORIES.has(p.category ?? '')
  );
}

/** The feature builder: growth and age inputs are computed, then switched off. */
export function buildFeatures(p: SnapshotProtocol, asOf: string): {
  growth: number;
  ageInput: number;
  ageDays: number | null;
} {
  const growth = clamp(p.change_7d ?? 0, -60, 120) / 100;
  const age = ageDays(p.listed_at, asOf);
  const ageInput = Math.log10((age ?? 365) + 1);
  return { growth, ageInput, ageDays: age };
}

/** Solve a small linear system by Gaussian elimination with partial pivoting. */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < 1e-12) throw new Error('regression is singular');
    if (piv !== col) {
      const tmp = m[col];
      m[col] = m[piv];
      m[piv] = tmp;
    }
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let c = r + 1; c < n; c++) s -= m[r][c] * x[c];
    x[r] = s / m[r][r];
  }
  return x;
}

interface Point {
  x: number;
  y: number;
  category: string | null;
}

/** OLS of log10 mcap on an intercept plus log10 TVL, via the normal equations. */
function fitOls(points: Point[]): {
  intercept: number;
  slope: number;
  residualSd: number;
  rSquared: number;
  residuals: number[];
} {
  const n = points.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    sxy += p.x * p.y;
  }
  const [intercept, slope] = solveLinear(
    [
      [n, sx],
      [sx, sxx],
    ],
    [sy, sxy],
  );
  const residuals = points.map((p) => p.y - (intercept + slope * p.x));
  const rss = residuals.reduce((t, r) => t + r * r, 0);
  const meanY = sy / n;
  const tss = points.reduce((t, p) => t + (p.y - meanY) ** 2, 0);
  const residualSd = Math.sqrt(rss / Math.max(1, n - 2));
  const rSquared = tss > 0 ? 1 - rss / tss : 0;
  return { intercept, slope, residualSd, rSquared, residuals };
}

function fitPowerLaw(comps: SnapshotProtocol[]): Fit {
  const points: Point[] = comps.map((p) => ({
    x: Math.log10(p.tvl_usd),
    y: Math.log10(p.mcap_usd as number),
    category: p.category,
  }));
  const { intercept, slope, residualSd, rSquared, residuals } = fitOls(points);
  // Category residual: mean residual per category, shrunk by CAT_SHRINK (0),
  // so every category adjustment is exactly 0 and the factor is 1.
  const sums = new Map<string, { total: number; count: number }>();
  points.forEach((p, i) => {
    const key = p.category ?? '';
    const cur = sums.get(key) ?? { total: 0, count: 0 };
    cur.total += residuals[i];
    cur.count += 1;
    sums.set(key, cur);
  });
  const categoryAdjustment = new Map<string, number>();
  for (const [key, { total, count }] of sums) {
    categoryAdjustment.set(key, (total / count) * CAT_SHRINK);
  }
  return { intercept, slope, residualSd, rSquared, n: points.length, categoryAdjustment };
}

interface Prediction {
  logValue: number;
  curve: number;
  implied: number;
  bandLow: number;
  categoryFactor: number;
  growthMultiplier: number;
  maturityMultiplier: number;
}

function predict(fit: Fit, p: SnapshotProtocol): Prediction {
  const adj = fit.categoryAdjustment.get(p.category ?? '') ?? 0;
  const logValue = fit.intercept + fit.slope * Math.log10(p.tvl_usd) + adj;
  const curve = 10 ** logValue;
  const implied = round3Sig(curve);
  const bandLow = round3Sig(10 ** (logValue - BAND_SD * fit.residualSd));
  // Growth and maturity inputs are OFF, so both multipliers are exactly 1.
  const growthMultiplier = USE_GROWTH ? 1 : 1;
  const maturityMultiplier = USE_AGE ? 1 : 1;
  return {
    logValue,
    curve,
    implied,
    bandLow,
    categoryFactor: 10 ** adj,
    growthMultiplier,
    maturityMultiplier,
  };
}

function validateFit(fit: Fit, comps: SnapshotProtocol[]): Validation {
  const points: Point[] = comps.map((p) => ({
    x: Math.log10(p.tvl_usd),
    y: Math.log10(p.mcap_usd as number),
    category: p.category,
  }));
  // Leave-one-out: refit without each comp in turn, median absolute error.
  const looErrors = points.map((_, i) => {
    const rest = points.filter((__, j) => j !== i);
    const f = fitOls(rest);
    return Math.abs(points[i].y - (f.intercept + f.slope * points[i].x));
  });
  const loo = `x${(10 ** medianUpper(looErrors)).toFixed(2)}`;
  // Out-of-sample: fit on comps listed before 2024-01-01, test on newer ones.
  const train = comps.filter((p) => p.listed_at !== null && p.listed_at < OOS_CUTOFF);
  const test = comps.filter((p) => p.listed_at !== null && p.listed_at >= OOS_CUTOFF);
  let oos = 'n/a';
  if (train.length >= 10 && test.length >= 10) {
    const f = fitOls(
      train.map((p) => ({
        x: Math.log10(p.tvl_usd),
        y: Math.log10(p.mcap_usd as number),
        category: p.category,
      })),
    );
    const errs = test.map((p) =>
      Math.abs(Math.log10(p.mcap_usd as number) - (f.intercept + f.slope * Math.log10(p.tvl_usd))),
    );
    oos = `x${(10 ** medianUpper(errs)).toFixed(2)} (n=${test.length})`;
  }
  // Deterministic bootstrap of the slope: mulberry32 seed 42, 200 resamples.
  const rng = mulberry32(BOOTSTRAP_SEED);
  const slopes: number[] = [];
  for (let k = 0; k < BOOTSTRAP_RESAMPLES; k++) {
    const sample: Point[] = [];
    for (let i = 0; i < points.length; i++) {
      sample.push(points[Math.floor(rng() * points.length)]);
    }
    slopes.push(fitOls(sample).slope);
  }
  const mean = slopes.reduce((t, s) => t + s, 0) / slopes.length;
  const sd = Math.sqrt(slopes.reduce((t, s) => t + (s - mean) ** 2, 0) / (slopes.length - 1));
  const bootstrap = `${mean.toFixed(2)} ± ${sd.toFixed(2)} (n=${BOOTSTRAP_RESAMPLES})`;
  return { comps: comps.length, r2: fit.rSquared.toFixed(2), oos, loo, bootstrap };
}

// ------------------------------------------------------------------ farm plan

function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function farmAction(category: string | null, name: string, capital: number): string {
  const c = (category ?? '').toLowerCase();
  const gas = capital >= 150 ? 'about $8 of gas' : 'about $4 of gas';
  if (c.includes('lending') || c.includes('cdp')) {
    return `Supply $${capital} of USDC to ${name} at under 50% loan-to-value and leave the position working; expect ${gas} for the deposit, done in about 15 minutes.`;
  }
  if (c.includes('dex') || c.includes('yield')) {
    return `Provide $${capital} of liquidity to the main pool of ${name} and keep the position open; expect ${gas} for the deposit, done in about 15 minutes.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC through ${name} and use the funds inside the app; expect ${gas} for the bridge, done in about 20 minutes.`;
  }
  if (c.includes('staking') || c.includes('restaking')) {
    return `Stake $${capital} of the chain staking asset through ${name} and leave it staked; expect ${gas} for the stake, done in about 15 minutes.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge; expect ${gas} for the deposit, done in about 20 minutes.`;
  }
  return `Deposit $${capital} of USDC into ${name} and keep the position open; expect ${gas} for the deposit, done in about 15 minutes.`;
}

function clampStep(step: string): string {
  let s = step.trim();
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  while (s.length < 20) {
    s = `${s} Hold the position and check the protocol's own page before acting.`;
  }
  return s;
}

interface Farm {
  capital: number;
  holdDays: number;
  gas: number;
  pool: number;
  share: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  net: number;
  steps: string[];
  ev: string;
}

function farmFor(p: SnapshotProtocol, bandLow: number, age: number | null): Farm {
  const capital = capitalFor(p.tvl_usd);
  const holdDays = holdDaysFor(age);
  const pool = Math.round(bandLow * POOL_SHARE);
  const gas = 3 + 8 + 2 * Math.ceil(holdDays / 7);
  const share = pool / FARMERS;
  const verdict: 'FARM' | 'THIN' | 'SKIP' =
    share >= 3 * gas ? 'FARM' : share >= gas ? 'THIN' : 'SKIP';
  const net = share - gas;
  const steps = [
    'Use one wallet for this farm and no other: one consistent wallet reads as one real user, while a spread across wallets reads as a sybil ring. Cost: no extra gas; time: set it up once, about 10 minutes.',
    farmAction(p.category, p.name, capital),
    'Do one real action a week and vary it — supply one week, move or top up the next — because the same click every week reads as a script. Cost: about $4 of gas per week; time: about 10 minutes a week.',
    `Hold the position for at least ${holdDays} days so it spans more than one snapshot; the band-low five-percent pool behind this farm is ${formatMoney(pool)}. Cost: no extra gas while holding; time: ${holdDays} days minimum.`,
    'Keep the wallet clean: no claim spam, no dust tokens and no exchange link, so the wallet reads as a real user. Cost: $0; time: about 5 minutes to check before each action.',
    "Before withdrawing, claim only from the link the protocol's own page publishes, never from a link in a chat or inbox. Cost: about $4 of gas to claim; time: about 10 minutes to verify the link.",
    'Log the wallet, the dates and every transaction hash in one place so the farm can be checked later. Cost: $0; time: about 5 minutes after each action.',
  ].map(clampStep);
  const ev =
    `Expected value: the ${formatMoney(pool)} band-low five-percent pool split across ${FARMERS.toLocaleString('en-US')} farmers gives $${share.toFixed(2)} per farmer against $${gas.toFixed(2)} of gas, net $${net.toFixed(2)} — one wallet, one position, no sybil spread.`;
  return { capital, holdDays, gas, pool, share, verdict, net, steps, ev };
}

// ------------------------------------------------------------------ board

export function buildRadar(snapshot: Snapshot): RadarData {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlistSet = new Set(snapshot.watchlist);
  const chosen: SnapshotProtocol[] = [];
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p === undefined) throw new Error(`board gate: watchlist slug ${slug} is missing from the snapshot`);
    chosen.push(p);
  }
  const chosenSlugs = new Set(chosen.map((p) => p.slug));
  const early = snapshot.protocols
    .filter((p) => isRankable(p) && !chosenSlugs.has(p.slug) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_COUNT);
  const comps = snapshot.protocols.filter(isComp);
  const fit = fitPowerLaw(comps);
  const validation = validateFit(fit, comps);

  const scored: BoardRow[] = [...chosen, ...early].map((p) => {
    const { ageDays: age } = buildFeatures(p, snapshot.as_of);
    const pred = predict(fit, p);
    const farm = farmFor(p, pred.bandLow, age);
    const formula =
      `log10 value = ${fit.intercept.toFixed(4)} + ${fit.slope.toFixed(4)} × log10 TVL; ` +
      `band low is −0.7σ (σ = ${fit.residualSd.toFixed(3)} dex)`;
    const note =
      `Power-law curve ${formatMoney(pred.curve)} fitted on ${fit.n} comps ` +
      `(R² ${fit.rSquared.toFixed(2)}, TVL elasticity ${fit.slope.toFixed(2)}); ` +
      `no category term; band low ${formatMoney(pred.bandLow)} at a 0.7σ haircut.`;
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      pre_token: true,
      age_days: age,
      implied_value_usd: pred.implied,
      band_low_usd: pred.bandLow,
      model: {
        curve_usd: round4(pred.curve),
        category_factor: round4(pred.categoryFactor),
        growth_multiplier: round4(pred.growthMultiplier),
        maturity_multiplier: round4(pred.maturityMultiplier),
        age_days: age,
        note,
        formula,
      },
      farm_steps: farm.steps,
      farm_ev: farm.ev,
      verdict: farm.verdict,
      net_usd: Math.round(farm.net * 100) / 100,
    };
  });
  scored.sort(
    (a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  scored.forEach((row, i) => {
    row.rank = i + 1;
  });

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_COUNT)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      change_7d: p.change_7d,
      age_days: ageDays(p.listed_at, snapshot.as_of),
    }));

  const compRows: CompRow[] = [...comps]
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({ slug: p.slug, name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd as number }));

  const earlySize = scored.filter((r) => !watchlistSet.has(r.slug)).length;
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    snapshot_size: snapshot.protocols.length,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: scored.length,
    early_size: earlySize,
    live_size: live.length,
    fit: {
      intercept: fit.intercept,
      slope: fit.slope,
      residual_sd: fit.residualSd,
      r_squared: fit.rSquared,
    },
    validation,
    rows: scored,
    live,
    comps: compRows,
  };
}

/** The board gate: refuse a board that breaks any of these rules. */
export function assertBoard(radar: RadarData): void {
  const rows = radar.rows;
  rows.forEach((row, i) => {
    if (row.rank !== i + 1) throw new Error(`board gate: rank ${row.rank} is not ${i + 1} in order`);
    if (i > 0 && row.implied_value_usd > rows[i - 1].implied_value_usd) {
      throw new Error('board gate: implied values rise as rank ascends');
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      throw new Error(`board gate: row ${row.slug} has no positive safe-integer implied value`);
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      throw new Error(`board gate: row ${row.slug} has ${row.farm_steps.length} farm steps`);
    }
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) {
        throw new Error(`board gate: row ${row.slug} has a farm step of ${step.length} characters`);
      }
    }
  });
  if (rows.length > 1 && rows.every((r) => r.implied_value_usd === rows[0].implied_value_usd)) {
    throw new Error('board gate: all rows share the same implied value');
  }
}

export function assertWatchlistCoverage(radar: RadarData, watchlist: string[]): void {
  const have = new Set(radar.rows.map((r) => r.slug));
  for (const slug of watchlist) {
    if (!have.has(slug)) throw new Error(`board gate: watchlist slug ${slug} is missing from the board`);
  }
}

/** Render the radar data as a script assigning it to window.RADAR. */
export function renderRadarScript(data: RadarData): string {
  return `window.RADAR = ${JSON.stringify(data)};\n`;
}
