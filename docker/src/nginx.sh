#!/bin/bash

sed -i -E "s/^([\t| ]{0,})error_log.+$/\1error_log stderr warn;/" /etc/nginx/nginx.conf
sed -i -E "s/^([\t| ]{0,})access_log.+$/\1access_log off;/"       /etc/nginx/nginx.conf

echo 'Starting nginx...'
nginx -g 'daemon off;' &
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
