FROM node:22-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
COPY . .

RUN npx prisma generate
# backend (dist/) + Mini App (public/: one inlined HTML, lazy chunks, service worker)
RUN npm run build && npm run build:web

# ── Production image ──────────────────────────────────────────────────────────
FROM node:22-alpine

# openssl — Prisma; postgresql-client — pg_dump for the daily backup to Telegram
RUN apk add --no-cache openssl postgresql-client

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 4002

# heap is capped; response caches live in Buffers outside the heap and limit themselves (CACHE_MAX_MB)
CMD ["node", "--max-old-space-size=256", "dist/main"]
