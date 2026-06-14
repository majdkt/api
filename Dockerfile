FROM node:22-bookworm-slim

WORKDIR /app

# Install system tools needed by diagnostics and systeminformation:
#   procps       → free, ps, uptime
#   iproute2     → ip, ss
#   iputils-ping → ping (required for si.inetLatency / CAP_NET_RAW must also be set in docker-compose)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       procps \
       iproute2 \
       iputils-ping \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src/ ./src/

EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
