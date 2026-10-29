# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium iptables util-linux ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY deploy/browser-reader/package.json deploy/browser-reader/package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --omit=dev --strict-ssl=true --no-audit --no-fund && npm cache clean --force
COPY server/browser-worker.js server/browser-policy.js server/public-url.js server/link-errors.js ./server/
COPY deploy/browser-reader/entrypoint.sh ./entrypoint.sh
RUN chmod -R a+rX /app && chmod 755 /app/entrypoint.sh
ENV CHROMIUM_PATH=/usr/bin/chromium NODE_ENV=production
EXPOSE 3002
ENTRYPOINT ["/app/entrypoint.sh"]
