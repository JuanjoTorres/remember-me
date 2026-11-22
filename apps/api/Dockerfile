# Build context: repository root (docker build -f apps/api/Dockerfile .)
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter api...
COPY packages/shared-types packages/shared-types
COPY apps/api apps/api
RUN pnpm --filter api... build

FROM build AS prod-deps
RUN pnpm --filter api deploy --prod --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /out/node_modules ./node_modules
COPY --from=prod-deps /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
