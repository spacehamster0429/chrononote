FROM node:24-bookworm-slim AS deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3030
ENV CHRONONOTE_DATA_DIR=/data

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git zip ffmpeg libstdc++6 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md ./
COPY public ./public
COPY src ./src
COPY README.md ./

RUN mkdir -p /data \
  && chown -R node:node /app /data

USER node

EXPOSE 3030
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3030/api/session').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npm", "start"]
