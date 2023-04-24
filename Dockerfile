FROM node:20
COPY . .
RUN yarn install --production
ENTRYPOINT ["node", "/src/main.js"]
