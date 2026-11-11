FROM node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 AS build
WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/core/package.json apps/core/package.json
RUN pnpm install --filter @nian/core... --frozen-lockfile

COPY apps/core apps/core
COPY infra/postgres/migrations infra/postgres/migrations
COPY specs specs
RUN pnpm --filter @nian/core build
# Core has no workspace runtime dependencies. Legacy deploy keeps the repository's
# normal workspace linking mode unchanged while producing a production-only tree.
RUN pnpm --filter @nian/core deploy --legacy --prod /opt/nian-core

FROM node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 AS runtime
ENV NODE_ENV=production
WORKDIR /opt/nian-core
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=build --chown=node:node /opt/nian-core ./
COPY --from=build --chown=node:node /workspace/infra/postgres/migrations ./infra/postgres/migrations
COPY --from=build --chown=node:node /workspace/specs ./specs

USER node
EXPOSE 3000
CMD ["node", "dist/entrypoint.js"]
