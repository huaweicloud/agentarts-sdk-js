import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(new URL('../../scripts/check-protocol-release.mjs', import.meta.url));
const fixtures: string[] = [];
afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});
function fixture(version: string, changeset?: string) {
  const path = mkdtempSync(join(tmpdir(), 'agentarts-protocol-release-'));
  fixtures.push(path);
  mkdirSync(join(path, 'packages/agentarts-sdk'), { recursive: true });
  mkdirSync(join(path, '.changeset'));
  writeFileSync(join(path, 'packages/agentarts-sdk/package.json'), JSON.stringify({ version }));
  if (changeset)
    writeFileSync(
      join(path, '.changeset/pending.md'),
      `---\n"${changeset}": minor\n---\nRelease\n`,
    );
  return path;
}
function check(path: string) {
  return spawnSync(process.execPath, [script], { cwd: path, encoding: 'utf8' });
}

it('prevents publishing adapters against an old SDK version that lacks the protocol API', () => {
  const result = check(fixture('0.0.1'));
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Apply the coordinated changeset');
});
it.each([
  '@huaweicloud/agentarts-sdk',
  '@huaweicloud/agentarts-protocol-a2a',
  '@huaweicloud/agentarts-protocol-agui',
])('prevents publishing an unversioned changeset for %s', (name) => {
  const result = check(fixture('0.1.0', name));
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Unversioned SDK/protocol changeset');
});
it.each(['0.1.0', '0.1.0-beta.1', '1.0.0'])(
  'allows the versioned protocol release %s',
  (version) => {
    const result = check(fixture(version));
    expect(result.status, result.stderr).toBe(0);
  },
);

it('the workflow dry-run resolves all four package versions without invoking publication', () => {
  const workflow = parse(readFileSync(join(root, '.github/workflows/publish-npm.yml'), 'utf8'));
  const metadata = workflow.jobs.verify.steps.find((step: any) => step.id === 'meta');
  const temp = fixture('0.1.0');
  const output = join(temp, 'github-output');
  const result = spawnSync('bash', ['-e', '-c', metadata.run], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      INPUT_DRY_RUN: 'true',
      INPUT_TAG: '',
      GITHUB_OUTPUT: output,
    },
  });
  expect(result.status, result.stderr).toBe(0);
  const values = readFileSync(output, 'utf8');
  for (const key of ['sdk_version', 'identity_version', 'a2a_version', 'agui_version'])
    expect(values).toContain(`${key}=`);
  expect(values).toContain('dry_run=true');
  // Parse each shell step without executing it, including the irreversible publish step.
  for (const job of Object.values(workflow.jobs) as any[])
    for (const step of job.steps) {
      if (step.run) {
        const syntax = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' });
        expect(syntax.status, `${step.name}: ${syntax.stderr}`).toBe(0);
      }
    }
});
