#!/usr/bin/env node
// Claude Code hook: an area of the repo can only be edited after its skill has been loaded in the
// session. The skill routes to the one reference that describes the part being changed.
// Wired in .claude/settings.json (PreToolUse). Set SKILL_GATE=off to disable it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

/** First match wins. Paths are relative to the repo root, with forward slashes. */
const ROUTES = [
  { area: 'ops', test: (p) => /(^|\/)Dockerfile$/.test(p) || p === '.dockerignore' },
  { area: 'ops', test: (p) => /^(deploy|scripts|\.github)\//.test(p) || p === 'compose.yaml' },
  { area: 'ops', test: (p) => p === 'docs/deploy.md' },
  { area: 'backend', test: (p) => /^(apps\/api|packages\/shared-types)\//.test(p) },
  { area: 'frontend', test: (p) => p.startsWith('apps/web/') },
];
const AREAS = [...new Set(ROUTES.map((route) => route.area))];

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd());
const session = String(input.session_id ?? 'no-session').replace(/[^\w.-]/g, '_');
const stateDir = join(tmpdir(), 'claude-skill-gate', session);
const marker = (area) => join(stateDir, area);
const mark = (area) => {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(marker(area), '');
};
const repoPath = (file) =>
  relative(root, resolve(root, String(file ?? '')))
    .split(sep)
    .join('/');

const tool = input.tool_name;
const args = input.tool_input ?? {};

if (tool === 'Skill') {
  const name = String(args.skill ?? '')
    .split(':')
    .pop();
  if (AREAS.includes(name)) mark(name);
} else if (tool === 'Read') {
  // Reading the skill file by hand counts too (agents without the Skill tool).
  const match = /^\.claude\/skills\/([\w-]+)\/SKILL\.md$/.exec(repoPath(args.file_path));
  if (match && AREAS.includes(match[1])) mark(match[1]);
} else if (process.env.SKILL_GATE !== 'off') {
  const path = repoPath(args.file_path ?? args.notebook_path);
  const area = ROUTES.find((route) => route.test(path))?.area;
  if (area && !existsSync(marker(area))) {
    const reason =
      `${path} belongs to the "${area}" area. Load the ${area} skill first (Skill tool, or read ` +
      `.claude/skills/${area}/SKILL.md), open the one reference it points to for this change, ` +
      `then retry. If the change alters something a reference describes, update that reference ` +
      `in the same change.`;
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      }),
    );
  }
}
