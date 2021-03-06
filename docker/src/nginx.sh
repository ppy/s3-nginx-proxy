#!/bin/bash

echo resolver $(awk 'BEGIN{ORS=" "} $1=="nameserver" {print $2}' /etc/resolv.conf) ";" > /etc/nginx/resolvers.conf # https://serverfault.com/a/638855

sed -i -E "s/^([\t| ]{0,})error_log.+$/\1error_log stderr warn;/" /etc/nginx/nginx.conf
sed -i -E "s/^([\t| ]{0,})access_log.+$/\1access_log off;/"       /etc/nginx/nginx.conf

echo 'Starting nginx config script...'
node /srv/config.js

echo 'Starting nginx...'
openresty -p /var/lib/nginx -c /etc/nginx/nginx.conf -g 'daemon off;' &
PID=$!

# reload on config edit
{
  while true; do
    inotifywait -r -e modify,move,create,delete /etc/nginx/
    echo 'Reloading nginx following config update...'
    kill -HUP $PID
  done
} &

wait $PID
