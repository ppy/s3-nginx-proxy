FROM alpine:3.13

RUN apk add --no-cache bash nodejs inotify-tools nginx nginx-mod-http-set-misc nginx-mod-http-lua
RUN mkdir /run/nginx

COPY ./src /srv

STOPSIGNAL SIGQUIT

CMD ["/srv/nginx.sh"]
