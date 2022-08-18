FROM alpine:3.12 AS base

RUN wget -O /etc/apk/keys/admin@openresty.com-5ea678a6.rsa.pub 'http://openresty.org/package/admin@openresty.com-5ea678a6.rsa.pub'
RUN echo "http://openresty.org/package/alpine/v3.12/main" >> /etc/apk/repositories

RUN apk add --no-cache bash nodejs inotify-tools nginx openresty

FROM base AS opm

RUN apk add --no-cache openresty-opm
RUN opm get ledgetech/lua-resty-http

FROM base

RUN mkdir /run/nginx

COPY --from=opm /usr/local/openresty/site /usr/local/openresty/site
COPY ./src /srv

STOPSIGNAL SIGQUIT

CMD ["/srv/nginx.sh"]
