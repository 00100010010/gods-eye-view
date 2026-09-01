FROM node:24.15.0-alpine3.22@sha256:b689d4005875ae167178471a7a622ec2909459a3bbb32277260be1971af7a99f

RUN apk upgrade --no-cache

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

COPY --chown=node:node . .
RUN npm run build \
  && mkdir -p /app/.gev-cache /app/.gev-logs /app/node_modules/.vite-temp \
  && chown -R node:node /app/.gev-cache /app/.gev-logs /app/node_modules/.vite-temp

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    VITE_CACHE_DIR=/tmp/vite-cache

USER node

EXPOSE 4173

CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173", "--strictPort"]
