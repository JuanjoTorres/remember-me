#!/usr/bin/env node
// Fails when a skill or an agent definition names a file that does not exist, so that the documents
// under .claude/skills and .claude/agents cannot drift silently when code is moved or deleted.
// Run with `pnpm check:docs`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skills = join(root, '.claude', 'skills');
// Agent definitions are optional; the skills are not, and a missing folder must fail loudly.
const agents = join(root, '.claude', 'agents');

const markdownFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return name.endsWith('.md') ? [path] : [];
  });

/** A backticked token is checked when it looks like a file in this repository. */
const looksLikeRepoPath = (token) =>
  token.includes('/') &&
  /\.[a-z0-9]+$/i.test(token) &&
  !/[\s<>*$|{}…]|^[/~@.]|:\/\/|^https?:/.test(token.replace(/^\.claude\//, 'claude/'));

const problems = [];
let checked = 0;
for (const file of [
  ...markdownFiles(skills),
  ...(existsSync(agents) ? markdownFiles(agents) : []),
]) {
  const text = readFileSync(file, 'utf8');
  // Skills and agent definitions are only loaded when their frontmatter names and describes them
  // and is closed. Other keys (an agent's `tools`) may follow the description.
  const needsFrontmatter = file.endsWith('SKILL.md') || file.startsWith(agents);
  if (
    needsFrontmatter &&
    !/^---\nname: [\w-]+\ndescription: .+\n(?:[\w-]+: .*\n)*---\n/.test(text)
  ) {
    problems.push(`${relative(root, file)}: missing "name" and "description" frontmatter`);
  }
  text.split('\n').forEach((line, index) => {
    for (const [, token] of line.matchAll(/`([^`\n]+)`/g)) {
      if (!looksLikeRepoPath(token)) continue;
      checked += 1;
      // Relative to the repository first, then to the file that mentions it (`references/x.md`).
      if (existsSync(join(root, token)) || existsSync(join(dirname(file), token))) continue;
      problems.push(`${relative(root, file)}:${index + 1}: \`${token}\` does not exist`);
    }
  });
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} broken reference(s). Fix the path or update the document.`);
  process.exit(1);
}
console.log(`check-docs: ${checked} file references in .claude/skills and .claude/agents exist.`);
