FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY web ./web
ENV DATA_DIR=/data PORT=3000 TZ=Europe/Moscow
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server/server.js"]
