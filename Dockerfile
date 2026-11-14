FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY public ./public
COPY src ./src
COPY tsconfig.json tailwind.config.js postcss.config.js ./
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/build ./build
COPY server ./server
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4318
USER node
EXPOSE 4318
CMD ["node", "server/index.mjs"]
