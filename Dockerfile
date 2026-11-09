FROM oven/bun:1.4.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY server server
COPY shared shared
COPY scripts scripts
COPY web web
RUN bun run build

FROM oven/bun:1.4.3-slim AS runtime
USER root
WORKDIR /app
RUN mkdir /data && chown bun:bun /data
COPY --from=build --chown=bun:bun /app/package.json /app/bun.lock ./
RUN bun install --production --frozen-lockfile
COPY --from=build --chown=bun:bun /app/dist dist
COPY --from=build --chown=bun:bun /app/server server
COPY --from=build --chown=bun:bun /app/shared shared
COPY --chown=bun:bun plugin/assets/icon.png plugin/assets/icon.png
USER bun
ENV SUPDANCE_PLUGIN_DATABASE=/data/plugin.sqlite
EXPOSE 8787
HEALTHCHECK CMD bun -e 'if (!(await fetch("http://127.0.0.1:8787/healthz")).ok) process.exit(1)'
CMD ["bun", "server/index.ts"]
