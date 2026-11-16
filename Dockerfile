FROM oven/bun:1-debian AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-debian

# A képrajzoláshoz (canvas) betűtípusok kellenek; a slim image-ben nincsenek.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules /app/node_modules
COPY package.json bun.lock /app/
COPY src /app/src

# A relatív STATE_FILE / ARCHIVE_FILE (a .env-ből) ide íródjon, ez a kötet.
RUN mkdir -p /data && chown bun:bun /data
WORKDIR /data

ENV NODE_ENV=production \
    TIMEZONE=Europe/Budapest \
    POLL_SECONDS=60 \
    STATE_FILE=/data/state.json \
    ARCHIVE_FILE=/data/weeks.json

USER bun

# Nincs port: a bot kimenő gateway kapcsolatot használ.
CMD ["bun", "run", "/app/src/bot.ts"]
