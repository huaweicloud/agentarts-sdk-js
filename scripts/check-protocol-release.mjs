import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const packages = new Set([
  '@huaweicloud/agentarts-sdk',
  '@huaweicloud/agentarts-protocol-a2a',
  '@huaweicloud/agentarts-protocol-agui',
]);

/** Publishing prototype peers against the already-published 0.0.x SDK is unsafe. */
export function checkProtocolRelease(root = process.cwd()) {
  const sdk = JSON.parse(
    readFileSync(resolve(root, 'packages/agentarts-sdk/package.json'), 'utf8'),
  );
  const version = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    sdk.version,
  );
  if (!version || (Number(version[1]) === 0 && Number(version[2]) === 0))
    throw new Error(
      'Protocol packages require SDK >=0.1.0. Apply the coordinated changeset before publishing.',
    );
  for (const file of readdirSync(resolve(root, '.changeset'))) {
    if (!file.endsWith('.md')) continue;
    const body = readFileSync(resolve(root, '.changeset', file), 'utf8');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)?.[1];
    if (!frontmatter) continue;
    const releases = parse(frontmatter);
    if (
      releases &&
      typeof releases === 'object' &&
      Object.keys(releases).some((name) => packages.has(name))
    )
      throw new Error(
        `Unversioned SDK/protocol changeset: ${file}. Run pnpm exec changeset version before publishing.`,
      );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkProtocolRelease();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid protocol release');
    process.exitCode = 1;
  }
}
