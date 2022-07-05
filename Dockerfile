FROM alpine:3.12

RUN wget -O /etc/apk/keys/admin@openresty.com-5ea678a6.rsa.pub 'http://openresty.org/package/admin@openresty.com-5ea678a6.rsa.pub'
RUN echo "http://openresty.org/package/alpine/v3.12/main" >> /etc/apk/repositories

RUN apk add --no-cache bash nodejs inotify-tools nginx openresty
RUN mkdir /run/nginx

COPY ./src /srv

STOPSIGNAL SIGQUIT

CMD ["/srv/nginx.sh"]
