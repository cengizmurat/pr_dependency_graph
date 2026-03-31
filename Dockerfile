FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:20-alpine AS server-build
WORKDIR /app/server
COPY server/package.json ./
RUN npm install
COPY server/ ./
RUN npx tsc

FROM node:20-alpine
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev
COPY --from=server-build /app/server/dist ./dist
COPY --from=client-build /app/client/dist ./client
EXPOSE 3000
CMD ["node", "dist/server.js"]
