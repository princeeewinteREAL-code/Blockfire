# Blockfire game server.
# Stage 1 builds the server bundle; stage 2 is a small image that only runs it.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --no-audit --no-fund
COPY shared shared
COPY server server
RUN npm run build -w server

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787
RUN npm install --no-audit --no-fund ws@8
COPY --from=build /app/server/dist/server.mjs ./server.mjs
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
