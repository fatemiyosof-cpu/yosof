FROM node:20.18.0-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js ./

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

CMD ["node", "server.js"]
