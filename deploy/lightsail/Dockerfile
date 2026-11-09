# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Optional CA mount is for managed build environments. Normal Lightsail builds
# use the image's system trust. No API key or store token belongs in this build.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --strict-ssl=true --no-audit --no-fund
COPY tsconfig.json vite.config.js index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3001
# Sharp/librsvg needs installed fonts for visible trial marks and store labels.
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core fonts-noto-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --omit=dev --strict-ssl=true --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/profiles.js ./src/profiles.js
COPY src/customer-hands.js ./src/customer-hands.js
COPY src/jewellery-definitions.js ./src/jewellery-definitions.js
COPY src/jewellery-overlay.js ./src/jewellery-overlay.js
COPY src/complete-look.js ./src/complete-look.js
COPY src/jewellery-sizing.js ./src/jewellery-sizing.js
COPY public/avatar-library*.png ./public/
COPY public/avatar-tones ./public/avatar-tones
COPY public/hands ./public/hands
# Source checkouts may use restrictive permissions; the runtime user must read
# the root-owned application and assets without gaining write access.
RUN chmod -R a+rX /app && mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e 'fetch("http://127.0.0.1:3001/api/health", {headers: {Authorization: "Bearer " + process.env.TRYON_MOBILE_TOKEN}, signal: AbortSignal.timeout(4000)}).then(r => {if (!r.ok) process.exit(1)}).catch(() => process.exit(1))'
CMD ["node", "server/index.js", "--production"]
