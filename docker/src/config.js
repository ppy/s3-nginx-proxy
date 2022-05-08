const fs = require("fs");

const S3_ACCESS_KEY = fs.readFileSync("/etc/s3-credentials/s3AccessKey").toString().trim();
const S3_SECRET_KEY = fs.readFileSync("/etc/s3-credentials/s3SecretKey").toString().trim();
const virtualHosts = require("/etc/proxy-config/virtualhosts.json");

const cache = {
  sizeLimit: "500M",
  inactiveExpiry: "120m",
  minFree: "4G",
  defaultCacheLength: "15m",
  purgeAuthorizationKey: "",
  ...require("/etc/proxy-config/cache.json"),
};

// parse kubernetes-style volume size to nginx
function parseSize(kubernetesSize) {
  const cacheParsedSizeLimit = /^(\d{0,})((G|M)i?)$/.exec(kubernetesSize); // [1] is size, [2] is unit
  if(cacheParsedSizeLimit) {
    let size = Number(cacheParsedSizeLimit[1]);
    const unit = cacheParsedSizeLimit[2];
    switch(unit) {
      case 'G':
        size *= 1000;
      case 'M':
        size *= 1000 * 1000;
        break;
      case 'Gi':
        size *= 1024;
      case 'M':
        size *= 1024 * 1024;
        break;
    }
    return size;
  }
}
cache.sizeLimit = parseSize(cache.sizeLimit);
cache.minFree = parseSize(cache.minFree);

// apply a safety margin (10% or 100M max)
cache.sizeLimit -= Math.min(cache.sizeLimit * 0.1, 100 * 1000 * 1000);

const configBlocks = [];

configBlocks.push(`
# ${cache.sizeLimit / 1000 / 1000}M max_size, ${cache.minFree / 1000 / 1000}M min_free
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=cache:10m max_size=${cache.sizeLimit} min_free=${cache.minFree} inactive=${cache.inactiveExpiry} use_temp_path=off;

map $request_uri $uri_path {
  "~^(?P<path>.*?)(\\?.*)*$"  $path;
}

include resolvers.conf;
`);

for(const virtualHost of virtualHosts) {
  const vhostCache = {
    any: cache.defaultCacheLength,
    ...virtualHost.cache,
  };
  const vhostCacheNginx = Object.entries(vhostCache)
    .map(([code, expiry]) => `  proxy_cache_valid ${code} ${expiry};`)
    .join("\n");
  configBlocks.push(`
server {
  listen 0.0.0.0:80;

  server_name "${virtualHost.hostnames.join('" "')}";

  proxy_cache cache;
  proxy_cache_key "${virtualHost.bucket}$request_uri";
  proxy_buffering on;

${vhostCacheNginx}

  add_header Cache-Control public;
  expires ${vhostCache["200"] ? vhostCache["200"] : vhostCache.any};

  location / {
    if ($request_method !~ ^(GET|DELETE)$) {
      return 403;
    }

    if ($request_method = DELETE) {
      set $lua_purge_path "/var/cache/nginx/";
      set $lua_purge_levels "1:2";
      set $lua_purge_cache_key "${virtualHost.bucket}$request_uri";
      set $lua_purge_authorization_key "${cache.purgeAuthorizationKey}";
      content_by_lua_file /srv/purge.lua;
    }

    set_by_lua_block $uri_path {
      return ngx.var.uri_path:gsub("+", "%%2B");
    }
    set_by_lua        $now            "return ngx.cookie_time(ngx.time())";
    set               $string_to_sign "GET\\n\\n\\n\${now}\\n/${virtualHost.bucket}$uri_path";
    set_hmac_sha1     $aws_signature  "${S3_SECRET_KEY}" "$string_to_sign";
    set_encode_base64 $aws_signature  "$aws_signature";

    ${virtualHost.defaultPath ? `error_page 403 @fallback;` : ""}
    ${virtualHost.defaultPath ? `error_page 404 @fallback;` : ""}

    proxy_set_header       Content-Type  "";
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
