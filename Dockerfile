FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=8787
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts ./scripts
COPY src/data ./src/data
COPY src/lib/catalog.js ./src/lib/catalog.js
COPY package.json ./
RUN mkdir -p /app/.data && chown -R node:node /app
USER node
VOLUME ["/app/.data"]
EXPOSE 8787
CMD ["npm", "start"]
