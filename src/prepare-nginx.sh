#!/bin/bash

echo resolver $(awk 'BEGIN{ORS=" "} $1=="nameserver" {print $2}' /etc/resolv.conf) "ipv6=off;" > /etc/nginx/resolvers.conf # https://serverfault.com/a/638855

sed -i -E "s/^([\t| ]{0,})error_log.+$/\1error_log stderr warn;/"                                            /etc/nginx/nginx.conf
sed -i -E "s/^([\t| ]{0,})access_log.+$/\1access_log off;/"                                                  /etc/nginx/nginx.conf
sed -i -E "s~^([\t| ]{0,})include /etc/nginx/http\.d/\*\.conf;$~\1include /etc/nginx/conf.d/s3-proxy.conf;~" /etc/nginx/nginx.conf

echo 'Starting nginx config script...'
node /srv/config.js
err=$?
if [[ $err -ne 0 ]]; then
  exit $err
fi

echo 'Validating nginx config...'
openresty -p /var/lib/nginx -c /etc/nginx/nginx.conf -g 'daemon off;' -t
err=$?
if [[ $err -ne 0 ]]; then
  echo 'nginx config validation failed'
  exit $err
fi
