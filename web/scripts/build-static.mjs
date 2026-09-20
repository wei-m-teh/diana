import { spawnSync } from 'node:child_process';
import { appendFile, cp, mkdir, readdir, rm, symlink } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const staging = join(root, '.static-build');
// Build a separate tree: the local Next.js API routes remain usable in `pnpm dev`.
// POST handlers cannot be included in a Next.js static export.
await mkdir(staging, { recursive: true });
// Next rebuilds its output while preserving its compilation/font cache.
for (const entry of await readdir(staging)) {
  if (entry !== '.next') await rm(join(staging, entry), { recursive: true, force: true });
}
for (const entry of await readdir(root)) {
  if (
    ['node_modules', '.next', 'out', '.static-build', '.git'].includes(entry) ||
    entry.startsWith('.env')
  )
    continue;
  await cp(join(root, entry), join(staging, entry), {
    recursive: true,
    filter(source) {
      const path = relative(root, source);
      const first = path.split('/')[0];
      return (
        !['node_modules', '.next', 'out', '.static-build', '.git'].includes(first) &&
        !first.startsWith('.env') &&
        path !== 'app/api' &&
        path !== 'lib/supabase' &&
        !path.endsWith('.tsbuildinfo')
      );
    },
  });
}
// Next requires metadata route handlers to opt into static generation explicitly.
// Apply only to this export; local development keeps request-specific previews.
await appendFile(
  join(staging, 'app/opengraph-image.tsx'),
  "\nexport const dynamic = 'force-static';\n"
);
await symlink(join(root, 'node_modules'), join(staging, 'node_modules'), 'dir');
const build = spawnSync(
  process.execPath,
  [join(root, 'node_modules/next/dist/bin/next'), 'build'],
  {
    cwd: staging,
    stdio: 'inherit',
    env: {
      ...process.env,
      DIANA_STATIC_EXPORT: '1',
      NEXT_PUBLIC_DIANA_STATIC: '1',
      NEXT_PUBLIC_APP_CONFIG_ENDPOINT: '',
      NEXT_PUBLIC_CONN_DETAILS_ENDPOINT: '',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  }
);
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
await rm(join(root, 'out'), { recursive: true, force: true });
await cp(join(staging, 'out'), join(root, 'out'), { recursive: true });
console.log('Static UI exported to web/out. CDK supplies config.json at deployment.');
