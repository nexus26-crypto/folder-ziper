# Multi-stage build for TanStack Start frontend
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Install deps
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

# Copy source
COPY . .

# Build the TanStack Start app (outputs to .output/)
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN bun run build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Copy the built output only
COPY --from=builder /app/.output ./.output

ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
