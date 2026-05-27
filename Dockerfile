FROM node:18-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY server.js .
RUN mkdir -p public
COPY fantazia-shop.html ./public/fantazia-shop.html
EXPOSE 3000
CMD ["node", "server.js"]
