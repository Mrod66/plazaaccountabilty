#!/usr/bin/env node
/**
 * Keeps this site current with the platform and the template it started from.
 * Runs on a development machine or in the editor (never deployed). Node 22+,
 * plus `tar` and `git` on the PATH. No dependencies.
 *
 *   npm run platform -- docs [--site URL]   live platform docs → .platform/docs/ (git-ignored)
 *   npm run platform -- check [--from DIR]  is a newer template release out?
 *   npm run platform -- upgrade [--to vX.Y.Z] [--from DIR] [--base DIR] [--dry-run]
 *   npm run platform -- jobs                 check background.json and its handlers (no network)
 *
 * WHERE RELEASES COME FROM: `template.json` `repo`.
 *   - `file:<path>` (today: the platform's templates are not published yet) — a
 *     folder holding the template at its NEWEST version, e.g.
 *     `file:templates/astro-static` inside a platform checkout. A relative
 *     path resolves against `$SITE_DIR` (that checkout's root), else
 *     against this project. `--from DIR` points at the folder directly.
 *     A folder holds one version, so `upgrade` merges 3-way only when
 *     `--base DIR` gives a copy of the OLD version; without it, files you
 *     changed are left as they are and listed for you to compare.
 *   - `owner/name` — a GitHub repository with `vX.Y.Z` tags (later).
 *
 * UPGRADE, file by file, from the version in `template.json` to the target:
 *   - MANAGED paths (`src/platform/**`, `docs/agent/**`, this script,
 *     `CHANGELOG.md`) are the template's own: replaced wholesale. Do not edit them; extend them from
 *     your own code instead.
 *   - Everything else is a 3-way merge (`git merge-file`): base = the old
 *     template, ours = your file, theirs = the new template. Your changes are
 *     kept; a clash is written with conflict markers and listed at the end.
 *   - A file you deleted stays deleted; a file the template added is added
 *     (unless you already have one at that path, which is merged).
 * Then `template.json` records the new version. Review with `git diff`, solve
 * the listed conflicts, run `npm install`, `npm run build`.
 */
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';

const ROOT = process.cwd();
const MANIFEST = join(ROOT, 'template.json');
const MANAGED = [/^src\/platform\//, /^docs\/agent\//, /^scripts\/platform\.mjs$/, /^CHANGELOG\.md$/];
const NEVER = [/^\.git\//, /^node_modules\//, /^dist\//, /^\.astro\//, /^\.wrangler\//, /^\.platform\//, /(^|\/)\.DS_Store$/, /^src\/generated\//, /^template\.json$/, /^\.env$/, /^\.dev\.vars/];
const SKIP_IN_MERGE = [/^package-lock\.json$/];

const [command = 'help', ...args] = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function readManifest() {
  if (!existsSync(MANIFEST)) throw new Error('template.json not found: run this from the project root.');
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

const semver = tag => tag.replace(/^v/, '').split('.').map(Number);
const newer = (a, b) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

async function github(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {accept: 'application/vnd.github+json', 'user-agent': 'site-platform-script'},
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`);
  return res;
}

/** `file:` source: the folder that holds the template's newest version. */
function localSource(repo) {
  const from = option('--from');
  if (from) return resolve(ROOT, from);
  if (!repo?.startsWith('file:')) return null;
  const path = repo.slice('file:'.length);
  if (isAbsolute(path)) return path;
  return resolve(process.env.SITE_DIR || ROOT, path);
}

function localVersion(dir) {
  const file = join(dir, 'template.json');
  if (!existsSync(file)) {
    throw new Error(`no template.json in ${dir}: pass --from <template folder> or set SITE_DIR.`);
  }
  const {version} = JSON.parse(readFileSync(file, 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`${file} has no X.Y.Z version.`);
  return `v${version}`;
}

async function latestTag(repo) {
  const local = localSource(repo);
  if (local) return localVersion(local);
  const tags = await (await github(`/repos/${repo}/tags?per_page=100`)).json();
  const versions = tags.map(t => t.name).filter(n => /^v\d+\.\d+\.\d+$/.test(n));
  if (!versions.length) throw new Error(`no release tags on ${repo}`);
  return versions.reduce((best, tag) => (newer(tag, best) ? tag : best));
}

/** Downloads and unpacks `repo@tag`; returns the folder holding the project. */
async function fetchTemplate(repo, tag, into) {
  const res = await github(`/repos/${repo}/tarball/${tag}`);
  const file = join(into, `${tag}.tar.gz`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const dir = join(into, tag);
  mkdirSync(dir, {recursive: true});
  execFileSync('tar', ['-xzf', file, '-C', dir, '--strip-components=1']);
  return dir;
}

function listFiles(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(base, full).split('\\').join('/');
    if (NEVER.some(re => re.test(rel + (statSync(full).isDirectory() ? '/' : '')))) continue;
    if (statSync(full).isDirectory()) listFiles(full, base, out);
    else out.push(rel);
  }
  return out;
}

const read = path => (existsSync(path) ? readFileSync(path) : null);
const same = (a, b) => a !== null && b !== null && Buffer.compare(a, b) === 0;

function write(path, data, dryRun) {
  if (dryRun) return;
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, data);
}

async function docs() {
  const site = (option('--site') ?? process.env.SITE_URL ?? '').replace(/\/+$/, '');
  if (!site) throw new Error('pass --site https://<your site host> (or set SITE_URL).');
  const out = join(ROOT, '.platform', 'docs');
  mkdirSync(out, {recursive: true});
  const get = url => fetch(url, {headers: {'user-agent': 'site-platform-script'}}).catch(() => null);

  // The platform's rules for sites (core + topics). The template's own copy is
  // docs/agent/; the live one wins when they differ.
  const base = `${site}/api/public/site/v1/agent-docs`;
  const index = await get(base);
  if (!index?.ok) throw new Error(`nothing saved: ${base} answered ${index?.status ?? 'no response'}.`);
  const core = await index.text();
  writeFileSync(join(out, 'core.md'), core);
  const topics = [...new Set([...core.matchAll(/([a-z0-9-]+(?:\/[a-z0-9-]+)?)\.md/g)].map(m => m[1]))];
  let saved = 1;
  for (const topic of topics) {
    const res = await get(`${base}/${topic}.md`);
    if (!res?.ok) continue;
    write(join(out, `${topic}.md`), await res.text(), false);
    saved++;
  }
  const version = core.match(/\(v([0-9a-f]{6,})\)/)?.[1] ?? 'unknown';
  writeFileSync(join(out, 'VERSION'), `${version}\n`);
  console.log(`saved ${saved} docs (platform rules v${version}) to .platform/docs/ — start with core.md.`);
}

async function check() {
  const manifest = readManifest();
  const latest = await latestTag(manifest.repo);
  const current = `v${manifest.version}`;
  if (newer(latest, current)) {
    console.log(`template ${current} → ${latest} is available. Read its CHANGELOG, then: npm run platform -- upgrade`);
    process.exitCode = 10;
  } else {
    console.log(`up to date (template ${current}).`);
  }
}

async function upgrade() {
  const manifest = readManifest();
  const dryRun = flag('--dry-run');
  const from = `v${manifest.version}`;
  const to = option('--to') ?? (await latestTag(manifest.repo));
  if (!newer(to, from)) return console.log(`nothing to do: ${from} is not older than ${to}.`);
  if (!dryRun) {
    try {
      const dirty = execFileSync('git', ['status', '--porcelain'], {cwd: ROOT}).toString().trim();
      if (dirty && !flag('--force')) {
        throw new Error('commit or stash your changes first (or pass --force), so the upgrade is one reviewable diff.');
      }
    } catch (error) {
      if (error.message.startsWith('commit')) throw error;
    }
  }

  const work = mkdtempSync(join(tmpdir(), 'site-upgrade-'));
  try {
    const local = localSource(manifest.repo);
    let oldDir, newDir;
    if (local) {
      if (to !== localVersion(local)) throw new Error(`${local} holds ${localVersion(local)}, not ${to}.`);
      newDir = local;
      oldDir = option('--base') ? resolve(ROOT, option('--base')) : null;
      if (oldDir && localVersion(oldDir) !== from) throw new Error(`--base holds ${localVersion(oldDir)}, not ${from}.`);
    } else {
      [oldDir, newDir] = await Promise.all([
        fetchTemplate(manifest.repo, from, work),
        fetchTemplate(manifest.repo, to, work),
      ]);
    }
    const files = new Set([...(oldDir ? listFiles(oldDir) : []), ...listFiles(newDir)]);
    const report = {replaced: [], merged: [], added: [], removed: [], conflicts: [], kept: []};

    for (const rel of [...files].sort()) {
      const base = oldDir ? read(join(oldDir, rel)) : null;
      const theirs = read(join(newDir, rel));
      const oursPath = join(ROOT, rel);
      const ours = read(oursPath);
      if (same(base, theirs)) continue; // the template did not change this file
      if (!oldDir && same(ours, theirs)) continue; // already the new version

      if (MANAGED.some(re => re.test(rel))) {
        if (theirs === null) {
          if (ours !== null && !dryRun) rmSync(oursPath);
          report.removed.push(rel);
        } else {
          write(oursPath, theirs, dryRun);
          report.replaced.push(rel);
        }
        continue;
      }
      if (SKIP_IN_MERGE.some(re => re.test(rel))) {
        report.kept.push(`${rel} (regenerate with npm install)`);
        continue;
      }
      if (theirs === null) {
        report.kept.push(`${rel} (removed upstream; delete it yourself if unused)`);
        continue;
      }
      if (!oldDir) {
        if (ours === null) {
          write(oursPath, theirs, dryRun);
          report.added.push(rel);
        } else {
          report.kept.push(`${rel} (differs from ${to}; no --base to merge against: compare it yourself)`);
        }
        continue;
      }
      if (ours === null) {
        if (base === null) {
          write(oursPath, theirs, dryRun);
          report.added.push(rel);
        } else {
          report.kept.push(`${rel} (you deleted it; upstream changed it)`);
        }
        continue;
      }
      if (same(ours, base) || same(ours, theirs)) {
        write(oursPath, theirs, dryRun);
        report.merged.push(rel);
        continue;
      }
      // 3-way merge: ours ← (base → theirs)
      const tmpOurs = join(work, 'ours'), tmpBase = join(work, 'base'), tmpTheirs = join(work, 'theirs');
      writeFileSync(tmpOurs, ours);
      writeFileSync(tmpBase, base ?? Buffer.alloc(0));
      writeFileSync(tmpTheirs, theirs);
      let conflicts = 0;
      try {
        execFileSync('git', ['merge-file', '-L', 'yours', '-L', from, '-L', to, tmpOurs, tmpBase, tmpTheirs]);
      } catch (error) {
        conflicts = error.status ?? 1;
      }
      write(oursPath, readFileSync(tmpOurs), dryRun);
      (conflicts ? report.conflicts : report.merged).push(conflicts ? `${rel} (${conflicts})` : rel);
    }

    if (!dryRun) writeFileSync(MANIFEST, `${JSON.stringify({...manifest, version: to.replace(/^v/, '')}, null, 2)}\n`);

    const show = (title, list) => list.length && console.log(`\n${title}:\n  ${list.join('\n  ')}`);
    console.log(`${dryRun ? '[dry run] ' : ''}template ${from} → ${to}`);
    show('replaced (managed)', report.replaced);
    show('merged', report.merged);
    show('added', report.added);
    show('removed (managed)', report.removed);
    show('left as is', report.kept);
    show('CONFLICTS — search for <<<<<<< and resolve', report.conflicts);
    console.log('\nnext: read CHANGELOG.md, resolve conflicts, npm install, npm run build, git diff.');
    if (report.conflicts.length) process.exitCode = 2;
  } finally {
    rmSync(work, {recursive: true, force: true});
  }
}

/**
 * `jobs`: the same checks the platform runs on background.json when you publish (names, keys,
 * timing, time zones), plus: every list a schedule uses has a handler in src/server/background.ts.
 * Offline; prints every problem at once.
 */
async function jobs() {
  const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
  const EVERY = new Set(['minute', 'hour', 'day', 'weekday', 'week', 'month']);
  const file = join(ROOT, 'background.json');
  const problems = [];
  if (!existsSync(file)) {
    console.log('background.json: none (no schedules). Sending jobs still works.');
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`background.json is not valid JSON: ${error.message}`);
  }
  const lists = manifest.lists ?? {};
  const schedules = manifest.schedules ?? {};
  for (const key of Object.keys(manifest)) if (!['lists', 'schedules', '$schema'].includes(key)) problems.push(`unknown key "${key}"`);
  for (const [name, list] of Object.entries(lists)) {
    if (!NAME.test(name)) problems.push(`lists.${name}: lower-case letters, digits, dashes`);
    for (const key of Object.keys(list ?? {})) if (!['retries', 'concurrency', 'label', 'ordered'].includes(key)) problems.push(`lists.${name}: unknown key "${key}"`);
    if (list?.ordered !== undefined && typeof list.ordered !== 'boolean') problems.push(`lists.${name}.ordered: true or false`);
    if (list?.retries !== undefined && !(Number.isInteger(list.retries) && list.retries >= 0 && list.retries <= 9)) problems.push(`lists.${name}.retries: 0 to 9`);
    if (list?.concurrency !== undefined && !(Number.isInteger(list.concurrency) && list.concurrency >= 1 && list.concurrency <= 100)) problems.push(`lists.${name}.concurrency: 1 to 100`);
  }
  const needed = new Set(Object.keys(lists));
  for (const [name, s] of Object.entries(schedules)) {
    const where = `schedules.${name}`;
    if (!NAME.test(name)) problems.push(`${where}: lower-case letters, digits, dashes`);
    for (const key of Object.keys(s ?? {})) if (!['list', 'cron', 'every', 'at', 'day', 'tz', 'label', 'data'].includes(key)) problems.push(`${where}: unknown key "${key}"`);
    const list = s?.list ?? name;
    if (!NAME.test(list)) problems.push(`${where}.list: a list name`);
    needed.add(list);
    if ((s?.cron === undefined) === (s?.every === undefined)) problems.push(`${where}: give "cron" OR "every"`);
    if (s?.cron !== undefined) {
      const fields = String(s.cron).trim().split(/\s+/);
      if (fields.length !== 5) problems.push(`${where}.cron: 5 fields (minute hour day month weekday)`);
      else if (fields[2] !== '*' && fields[4] !== '*') problems.push(`${where}.cron: a day of the month OR a weekday, not both (use two schedules)`);
    }
    if (s?.every !== undefined && !EVERY.has(s.every)) problems.push(`${where}.every: one of ${[...EVERY].join(', ')}`);
    if (s?.at !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.at)) problems.push(`${where}.at: "HH:MM" (24-hour)`);
    if (s?.day !== undefined && !(Number.isInteger(s.day) && s.day >= 0 && s.day <= 6)) problems.push(`${where}.day: 0 (Sunday) to 6 (Saturday)`);
    if (s?.tz !== undefined) {
      try {
        new Intl.DateTimeFormat('en', {timeZone: s.tz});
      } catch {
        problems.push(`${where}.tz: "${s.tz}" is not a time zone`);
      }
    }
  }
  const handlersFile = join(ROOT, 'src/server/background.ts');
  const handlers = existsSync(handlersFile) ? readFileSync(handlersFile, 'utf8').replace(/\/\/.*$/gm, '') : '';
  for (const list of needed) {
    if (!new RegExp(`['"]?${list}['"]?\\s*:`).test(handlers)) problems.push(`no handler for "${list}" in src/server/background.ts`);
  }
  if (problems.length) {
    console.log(`background.json: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`background.json: ok (${Object.keys(lists).length} list(s), ${Object.keys(schedules).length} schedule(s)). The platform checks it again when you publish.`);
}

const commands = {docs, check, upgrade, jobs};
if (!commands[command]) {
  console.log('usage: npm run platform -- docs [--site URL] | check [--from DIR] | upgrade [--to vX.Y.Z] [--from DIR] [--base DIR] [--dry-run] [--force] | jobs');
} else {
  commands[command]().catch(error => {
    console.error(`platform ${command}: ${error.message}`);
    process.exitCode = 1;
  });
}
