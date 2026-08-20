#!/usr/bin/env node
/**
 * scripts/release.js — version bump → test → npm publish → tag → gh release
 * Usage: node scripts/release.js [major|minor|patch] [--dry-run]
 *        node scripts/release.js --dry-run
 *        node scripts/release.js minor
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bumpArg = args.find(a => ['major', 'minor', 'patch'].includes(a));

function sh(cmd, opts = {}) {
  console.log((dryRun && cmd.includes('npm publish') ? '[dry-run] ' : '') + '$ ' + cmd);
  if (dryRun && (cmd.includes('npm publish') || cmd.startsWith('git push') || cmd.startsWith('gh release'))) {
    console.log('  (skipped in dry-run)');
    return '';
  }
  return execSync(cmd, { stdio: opts.silent ? 'pipe' : 'inherit', encoding: 'utf8' });
}

function shOut(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

const root = path.resolve(__dirname, '..');
process.chdir(root);

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const current = pkg.version;
console.log(`Current version: ${current}`);

let next = current;
if (bumpArg) {
  const parts = current.split('.').map(Number);
  if (bumpArg === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0; }
  else if (bumpArg === 'minor') { parts[1]++; parts[2] = 0; }
  else if (bumpArg === 'patch') { parts[2]++; }
  next = parts.join('.');
  console.log(`Bumping ${bumpArg}: ${current} -> ${next}`);
  if (!dryRun) {
    pkg.version = next;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    const mcpPkgPath = path.join(root, 'mcp', 'package.json');
    if (fs.existsSync(mcpPkgPath)) {
      const mcpPkg = JSON.parse(fs.readFileSync(mcpPkgPath, 'utf8'));
      mcpPkg.version = next;
      fs.writeFileSync(mcpPkgPath, JSON.stringify(mcpPkg, null, 2) + '\n');
      console.log('Updated mcp/package.json');
    }
  } else {
    console.log(`[dry-run] would write ${next} to package.json`);
  }
} else {
  console.log('No bump type given; using current version.');
}

console.log('\nRunning tests...');
try {
  execSync('npm test', { stdio: 'inherit' });
} catch {
  console.error('Tests failed — aborting release.');
  process.exit(1);
}

if (dryRun) {
  console.log('\n[dry-run] Skipping publish / tag / release.');
  let log = '';
  try { log = shOut('git log --oneline $(git describe --tags --abbrev=0 2>nul || echo HEAD~5)..HEAD 2>nul || git log --oneline -10'); } catch { log = '(no tags yet)'; }
  console.log('\nRelease notes preview:\n' + log);
  console.log(`\n[dry-run] Would publish v${next}, tag v${next}, and create gh release.`);
  process.exit(0);
}

console.log(`\nPublishing v${next}...`);
sh('npm publish');
sh(`git tag v${next}`);
sh(`git push origin v${next}`);
try {
  const notes = shOut(`git log --oneline $(git describe --tags --abbrev=0 HEAD~1 2>nul || echo HEAD~10)..HEAD 2>nul || git log --oneline -10`);
  fs.writeFileSync('/tmp/release-notes.txt', notes);
  sh(`gh release create v${next} --title v${next} --notes-file /tmp/release-notes.txt`);
} catch (e) {
  console.warn('gh release failed:', e.message);
}
console.log(`\nReleased v${next}`);
