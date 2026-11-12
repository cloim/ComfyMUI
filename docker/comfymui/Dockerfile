# syntax=docker/dockerfile:1
# Multi-stage build for ComfyMUI Node.js 24 application

# --- Stage 1: Build Frontend Assets ---
FROM node:24-slim AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.json tsconfig.tsbuildinfo* vite.config.ts index.html object-info.mjs ./
COPY public ./public
COPY src ./src

RUN npm ci && npm run build

# --- Stage 2: Production Runtime ---
FROM node:24-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=4173 \
    HOST=0.0.0.0

# Install curl for container healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Install production dependencies only (including native sharp)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built frontend assets from builder stage
COPY --from=builder /app/dist ./dist

# Copy backend server files
COPY server.mjs state-db.mjs gallery.mjs object-info.mjs ./

EXPOSE 4173

CMD ["node", "server.mjs"]
