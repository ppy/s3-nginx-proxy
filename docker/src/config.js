const fs = require("fs");

const S3_ACCESS_KEY = fs.readFileSync("/etc/s3-credentials/s3AccessKey").toString().trim();
const S3_SECRET_KEY = fs.readFileSync("/etc/s3-credentials/s3SecretKey").toString().trim();
const virtualHosts = require("/etc/proxy-config/virtualhosts.json");

const cache = require("/etc/proxy-config/cache.json");
const cacheParsedSizeLimit = /^(\d{0,})(G|M)i$/.exec(cache.sizeLimit); // [1] is size, [2] is unit
if(cacheParsedSizeLimit) {
  // convert size limit from kubernetes format to nginx, plus apply a safety margin (10%)
  // eg: 5Gi -> 4g
  cache.sizeLimit = `${Math.trunc(Number(cacheParsedSizeLimit[1]) * 0.9)}${cacheParsedSizeLimit[2].toLowerCase()}`;
}

const configBlocks = [];

configBlocks.push(`
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=cache:10m max_size=${cache.sizeLimit} inactive=${cache.expiry} use_temp_path=off;
proxy_cache_valid 200 302 ${cache.expiry};

map $request_uri $uri_path {
  "~^(?P<path>.*?)(\\?.*)*$"  $path;
}

include resolvers.conf;
`);

for(const virtualHost of virtualHosts) {
  configBlocks.push(`
server {
  listen 0.0.0.0:80;

  server_name "${virtualHost.hostnames.join('" "')}";

  proxy_cache cache;
  proxy_cache_key "${virtualHost.bucket}$request_uri";
  proxy_buffering on;

  add_header Cache-Control public;
  expires 60m;

  location / {
    limit_except GET {
      deny all;
    }

    set_by_lua        $now            "return ngx.cookie_time(ngx.time())";
    set               $string_to_sign "GET\\n\\n\\n\${now}\\n/${virtualHost.bucket}$uri_path";
    set_hmac_sha1     $aws_signature  "${S3_SECRET_KEY}" "$string_to_sign";
    set_encode_base64 $aws_signature  "$aws_signature";

    ${virtualHost.defaultPath ? `error_page 403 @fallback;` : ""}
    ${virtualHost.defaultPath ? `error_page 404 @fallback;` : ""}

    proxy_set_header       Date          "$now";
    proxy_set_header       Host          "${virtualHost.bucket}.s3.amazonaws.com";
    proxy_set_header       Authorization "AWS ${S3_ACCESS_KEY}:$aws_signature";
    proxy_intercept_errors on;
    proxy_pass             "https://s3-${virtualHost.region}.amazonaws.com$uri_path";
  }

  ${virtualHost.defaultPath ? `
    location @fallback {
      rewrite ^ "${virtualHost.defaultPath}";
      set $uri_path "${virtualHost.defaultPath}";
    }
  `: ""}
}
`);
}

fs.writeFileSync("/etc/nginx/conf.d/s3-proxy.conf", configBlocks.join(""));

console.log("Successfully generated config!");
