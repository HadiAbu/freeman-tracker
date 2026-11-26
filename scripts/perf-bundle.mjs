// Measures what ships: runs a production export per platform and reports bundle and asset sizes.
// Usage: npm run perf:bundle   (add `-- --json` for machine-readable output)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const platforms = ['android', 'ios'];
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const results = {};
for (const platform of platforms) {
  const out = mkdtempSync(join(tmpdir(), `freeman-export-${platform}-`));
  try {
    execFileSync('npx', ['expo', 'export', '--platform', platform, '--output-dir', out], {
      stdio: 'ignore',
      shell: true,
      env: { ...process.env, CI: '1' },
    });
    const files = walk(out).map((f) => ({ f, size: statSync(f).size }));
    const bundle = files.filter((x) => /\.(hbc|js)$/.test(x.f) && x.f.includes('_expo'));
    const assets = files.filter((x) => x.f.includes(`${join(out, 'assets')}`));
    results[platform] = {
      bundleBytes: bundle.reduce((a, x) => a + x.size, 0),
      assetBytes: assets.reduce((a, x) => a + x.size, 0),
      assetCount: assets.length,
    };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log('| Platform | JS bundle (Hermes) | Assets | Asset files |');
  console.log('|---|---|---|---|');
  for (const [p, r] of Object.entries(results)) {
    console.log(`| ${p} | ${kb(r.bundleBytes)} | ${kb(r.assetBytes)} | ${r.assetCount} |`);
  }
}
