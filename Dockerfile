FROM node:9-alpine
MAINTAINER Popov Gennadiy <gennadiy.popov.87@yandex.ru>

WORKDIR /usr/src/proxy
COPY package*.json ./
RUN apk update && apk add yarn python g++ make && rm -rf /var/cache/apk/*

RUN yarn

COPY . .
EXPOSE 80
EXPOSE 443

CMD [ "npm", "start" ]
