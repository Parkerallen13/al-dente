# Production image for Fly.io (see fly.toml). Recipes, posts and the profile are
# written to DATA_DIR, which fly.toml mounts as a persistent volume.
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server.js"]
