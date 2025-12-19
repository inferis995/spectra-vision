# ================================
# Spectra Vision - Dockerfile
# Sci-Fi Ring Doorbell Interface
# ================================

FROM node:18-alpine

# Install FFmpeg (required for video streaming)
RUN apk add --no-cache ffmpeg

# Create app directory
WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source files
COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/

# Create directories for snapshots and recordings
RUN mkdir -p public/snapshots public/recordings

# Expose the application port
EXPOSE 3005

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3005/ || exit 1

# Start the application
CMD ["node", "server.js"]
