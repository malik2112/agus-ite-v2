// AGUS RADAR — entrypoint.
//
// Reads the sealed snapshot, builds the ranked board, and writes the
// dashboard's data, the board, the dossier and the copied dashboard and
// screenshots into the output directory. Node 22, standard library only.
//
//   node main.ts [--input <snapshot.json or dir>] [--output <dir>]
//
// Defaults: input /input (a directory holding snapshot.json), output from
// MAKEFUN_OUTPUT_DIR, else /output. A bare run with no arguments is the
// grader's run.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import {
  assertBoard,
  assertWatchlistCoverage,
  buildRadar,
  parseSnapshot,
  renderRadarScript,
} from './lib/model.ts';

const SCREENSHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function fail(message: string, code: number): never {
  console.error(`agus-radar: ${message}`);
  process.exit(code);
}

function flagValue(argv: string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && i + 1 < argv.length) return argv[i + 1];
    if (argv[i].startsWith(`${name}=`)) return argv[i].slice(name.length + 1);
  }
  return undefined;
}

/** Resolve --input: a file ending .json, or a directory holding snapshot.json. */
function resolveInput(raw: string): string {
  if (raw.endsWith('.json')) return raw;
  return join(raw, 'snapshot.json');
}

/** Copy files only (no directories, no dotfiles) from src into dst, recursively. */
function copyFilesOnly(srcDir: string, dstDir: string): string[] {
  const copied: string[] = [];
  const walk = (src: string, dst: string): void => {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const from = join(src, entry.name);
      const to = join(dst, entry.name);
      if (entry.isDirectory()) {
        walk(from, to);
      } else if (entry.isFile()) {
        writeFileSync(to, readFileSync(from));
        copied.push(to);
      }
    }
  };
  walk(srcDir, dstDir);
  return copied;
}

function main(): void {
  const argv = process.argv.slice(2);
  const inputArg = flagValue(argv, '--input') ?? '/input';
  const outputDir = resolve(
    flagValue(argv, '--output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output',
  );
  const snapshotPath = resolveInput(inputArg);
  if (!existsSync(snapshotPath)) {
    fail(`snapshot not found: ${snapshotPath}`, 2);
  }
  let snapshot;
  try {
    snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  } catch (err) {
    fail(`cannot parse snapshot: ${(err as Error).message}`, 1);
  }

  const radar = buildRadar(snapshot);
  try {
    assertBoard(radar);
    assertWatchlistCoverage(radar, snapshot.watchlist);
  } catch (err) {
    fail((err as Error).message, 1);
  }

  const repoRoot = dirname(fileURLToPath(import.meta.url));
  const shotsDir = join(repoRoot, 'screenshots');
  if (!existsSync(shotsDir) || !statSync(shotsDir).isDirectory()) {
    fail('screenshots/ directory is missing from the repository', 1);
  }
  const shotNames = readdirSync(shotsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name);
  if (shotNames.length < 3) {
    fail(`screenshots/ holds ${shotNames.length} screenshots, at least 3 are required`, 1);
  }
  for (const name of shotNames) {
    if (!SCREENSHOT_NAME.test(name)) {
      fail(`screenshot name ${name} is not allowed`, 1);
    }
  }

  mkdirSync(outputDir, { recursive: true });
  const boardPath = join(outputDir, 'board.json');
  const dataPath = join(outputDir, 'data.js');
  const dossierPath = join(outputDir, 'dossier.json');
  writeFileSync(boardPath, `${JSON.stringify({ rows: radar.rows }, null, 2)}\n`, 'utf8');
  writeFileSync(dataPath, renderRadarScript(radar), 'utf8');
  copyFilesOnly(join(repoRoot, 'dashboard'), join(outputDir, 'dashboard'));
  copyFilesOnly(shotsDir, join(outputDir, 'screenshots'));
  try {
    writeFileSync(
      dossierPath,
      buildDossier(outputDir, {
        text_max_bytes: 65536,
        screenshots: { max: 4, max_bytes: 524288 },
        dashboard: { max_files: 400, max_bytes: 4194304 },
      }),
    );
  } catch (err) {
    fail(`cannot build dossier: ${(err as Error).message}`, 1);
  }

  console.log(
    `protocols=${snapshot.protocols.length} watchlist=${snapshot.watchlist.length} ` +
      `rows=${radar.board_size} early=${radar.early_size} live=${radar.live_size}`,
  );
  console.log(`wrote board.json data.js dossier.json dashboard/ screenshots/ to ${outputDir}`);
}

main();
