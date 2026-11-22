# Dependencies

Every direct dependency, its license and why it is here. Check the license before adding a package;
nothing that needs a commercial license. Versions are pinned in the `package.json` files.

## Runtime

| Package                                | License    | Used by | Why                                      |
| -------------------------------------- | ---------- | ------- | ---------------------------------------- |
| next, react, react-dom                 | MIT        | web     | Framework                                |
| next-intl                              | MIT        | web     | es/en UI                                 |
| framer-motion                          | MIT        | web     | Story and reveal animations              |
| @tanstack/react-query                  | MIT        | web     | Server state in the editor               |
| canvas-confetti                        | ISC        | web     | Reveal celebration                       |
| zod                                    | MIT        | all     | Contracts and env validation             |
| @nestjs/common, core, platform-express | MIT        | api     | Framework                                |
| @nestjs/event-emitter                  | MIT        | api     | In-memory `EventBus` driver              |
| reflect-metadata, rxjs                 | Apache-2.0 | api     | Required by NestJS                       |
| @prisma/client, @prisma/adapter-pg     | Apache-2.0 | api     | Database access                          |
| pg                                     | MIT        | api     | PostgreSQL driver for the Prisma adapter |

## Development

| Package                                                | License          | Why                                  |
| ------------------------------------------------------ | ---------------- | ------------------------------------ |
| typescript                                             | Apache-2.0       | 6.0.x: typescript-eslint needs < 6.1 |
| turbo, prettier, eslint, typescript-eslint, @eslint/js | MIT              | Task runner, formatter, linter       |
| eslint-config-next                                     | MIT              | Next.js lint rules                   |
| tailwindcss, @tailwindcss/postcss                      | MIT              | Styling                              |
| prisma                                                 | Apache-2.0       | Migrations and client generation     |
| @nestjs/cli, @nestjs/testing                           | MIT              | Dev server, test module              |
| vitest, @vitejs/plugin-react                           | MIT              | Test runner                          |
| unplugin-swc, @swc/core                                | MIT / Apache-2.0 | Decorator metadata in API tests      |
| supertest                                              | MIT              | HTTP assertions                      |
| @testcontainers/postgresql                             | MIT              | Real PostgreSQL in integration tests |
| jsdom, @testing-library/\*                             | MIT              | Component tests                      |

## Decisions

- **TypeScript 6.0.3, not 7:** `typescript-eslint` 8.73 declares `typescript >=4.8.4 <6.1.0`.
- **Prisma 7.10.1, not 8:** version 8 is a release candidate.
- **@tanstack/react-query 5.108.1:** 5.108.3 was published the day the lockfile was created and is rejected
  by pnpm's minimum release age policy. Do not add `minimumReleaseAgeExclude` entries to bypass it.
- **Install scripts** are allow-listed in `pnpm-workspace.yaml` (`allowBuilds`): only Prisma, SWC and sharp.
