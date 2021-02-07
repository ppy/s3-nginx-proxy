#!/bin/bash

echo 'Starting nginx config script...'
node /srv/config.js

# reload on config edit
while true; do
  inotifywait -e modify,move,create,delete /etc/proxy-config/virtualhosts.json /etc/s3-credentials/s3AccessKey /etc/s3-credentials/s3SecretKey
    echo 'Regenerating nginx config following variables update...'
  node /srv/config.js
done
