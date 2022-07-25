#!/bin/bash

/srv/prepare-nginx.sh
err=$?
if [[ $err -ne 0 ]]; then
  echo 'aborting'
  exit $err
fi

echo 'Starting nginx...'
openresty -p /var/lib/nginx -c /etc/nginx/nginx.conf -g 'daemon off;' &
PID=$!

# reload on config edit
{
  while true; do
    inotifywait -r -e modify,move,create,delete /etc/nginx/
    echo 'Detected an nginx config update, running validation...'

    openresty -p /var/lib/nginx -c /etc/nginx/nginx.conf -g 'daemon off;' -t
    if [[ $? -ne 0 ]]; then
      echo 'nginx config validation failed, not reloading'
      continue
    fi

    echo 'Reloading nginx following config update...'
    kill -HUP $PID
  done
} &

wait $PID
