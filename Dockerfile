# Build stage
FROM node:20-alpine AS builder

ARG VITE_APP_BASE=/
ARG VITE_API_BASE_URL=

WORKDIR /app

# Install dependencies for server
COPY server/package*.json ./server/
RUN cd server && npm install

# Install dependencies for frontend
COPY web/package*.json ./web/
RUN cd web && npm install --legacy-peer-deps

# Copy source code
COPY server ./server
COPY web ./web

# Generate Prisma client
RUN cd server && npx prisma generate

# Build server
RUN cd server && npm run build

# Build frontend
ENV VITE_APP_BASE=$VITE_APP_BASE
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN cd web && npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy server
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/server/prisma ./server/prisma

# Copy frontend build to public
COPY --from=builder /app/web/dist ./public

# Set working directory to server
WORKDIR /app/server

# Run database migrations and start server
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]

EXPOSE 3000
