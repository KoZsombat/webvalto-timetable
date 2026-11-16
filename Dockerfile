FROM oven/bun:1-debian AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-debian
WORKDIR /app

# A képrajzoláshoz (canvas) betűtípusok kellenek; a slim image-ben nincsenek.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY src ./src

RUN mkdir -p /data && chown bun:bun /data

ENV NODE_ENV=production \
    TIMEZONE=Europe/Budapest \
    POLL_SECONDS=60 \
    STATE_FILE=/data/state.json \
    ARCHIVE_FILE=/data/weeks.json

USER bun

# Nincs port: a bot kimenő gateway kapcsolatot használ.
CMD ["bun", "run", "src/bot.ts"]
