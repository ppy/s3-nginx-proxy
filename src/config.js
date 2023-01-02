const fs = require("fs");

const secrets = require("/etc/proxy-config/secrets.json");
const virtualHosts = require("/etc/proxy-config/virtualhosts.json");
const metrics = require("/etc/proxy-config/metrics.json");

const cache = {
  cachePath: "/var/cache/nginx",
  sizeLimit: "500M",
  inactiveExpiry: "120m",
  minFree: "4G",
  keysZoneSize: "10m",
  defaultCacheLength: "15m",
  purgeAuthorizationKey: "",
  purgeCloudflareZoneId: "",
  purgeCloudflareApiToken: "",
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

// apply a safety margin (10% or 4G max)
cache.sizeLimit -= Math.min(cache.sizeLimit * 0.1, 4000 * 1000 * 1000);

const configBlocks = [];

configBlocks.push(`
include resolvers.conf;

lua_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;

# ${cache.sizeLimit / 1000 / 1000}M max_size, ${cache.minFree / 1000 / 1000}M min_free
proxy_cache_path ${cache.cachePath} levels=1:2 keys_zone=cache:${cache.keysZoneSize} max_size=${cache.sizeLimit} min_free=${cache.minFree} inactive=${cache.inactiveExpiry} use_temp_path=off;

map $request_uri $uri_path {
  "~^(?P<path>.*?)(\\?.*)*$"  $path;
}
`);

if (virtualHosts.some((vhost) => vhost.forceImageMimeType)) {
  configBlocks.push(`
    map $upstream_http_content_type $image_type {
      "~*image/.+" $upstream_http_content_type;
      default image/jpeg;
    }
  `);
}

for(const virtualHost of virtualHosts) {
  const vhostCache = {
    any: cache.defaultCacheLength,
    ...virtualHost.cache,
  };
  const vhostCacheNginx = Object.entries(vhostCache)
    .map(([code, expiry]) => `  proxy_cache_valid ${code} ${expiry};`)
    .join("\n");

  const secret = secrets[virtualHost.secrets];
  let authNginx = "";
  if (secret) {
    authNginx = `
      set_by_lua        $now            "return ngx.cookie_time(ngx.time())";
      set               $string_to_sign "GET\\n\\n\\n\${now}\\n/${virtualHost.bucket}$uri_path";
      set_hmac_sha1     $aws_signature  "${secret.secretKey}" "$string_to_sign";
      set_encode_base64 $aws_signature  "$aws_signature";
      proxy_set_header  Date            "$now";
      proxy_set_header  Authorization   "AWS ${secret.accessKey}:$aws_signature";
    `;
  }
  else if (virtualHost.secrets) {
    throw new Error('Missing secret for ' + virtualHost.hostnames.join(','));
  }

  const upstream = virtualHost.upstream || `s3-${virtualHost.region}.amazonaws.com`;
  const cacheKey = `${virtualHost.cacheKey || `${virtualHost.bucket}$uri_path$args`}`;

  configBlocks.push(`
server {
  listen 0.0.0.0:80;

  server_name "${virtualHost.hostnames.join('" "')}";

  proxy_cache cache;
  proxy_cache_key "${cacheKey}";
  proxy_buffering on;

${vhostCacheNginx}

  ${virtualHost.forceImageMimeType ? 'add_header Content-Type $image_type always;' : ''}

  add_header Cache-Control public;
  expires ${vhostCache["200"] ? vhostCache["200"] : vhostCache.any};

  location / {
    if ($request_method !~ ^(GET|DELETE)$) {
      return 403;
    }

    if ($request_method = DELETE) {
      set $lua_purge_path "${cache.cachePath}";
      set $lua_purge_levels "1:2";
      set $lua_purge_cache_key "${cacheKey}";
      set $lua_purge_authorization_key "${cache.purgeAuthorizationKey}";
      set $lua_purge_cloudflare_zoneid "${cache.purgeCloudflareZoneId}";
      set $lua_purge_cloudflare_apitoken "${cache.purgeCloudflareApiToken}";
      content_by_lua_file /srv/purge.lua;
    }

    set_by_lua_block $uri_path {
      return ngx.var.uri_path:gsub("+", "%%2B");
    }

    ${authNginx}

    error_page 404 =${virtualHost.defaultStatusCode || 404} @fallback;
    error_page 403 =${virtualHost.defaultStatusCode || 404} @fallback;

    proxy_set_header       Content-Type  "";
    proxy_set_header       Host          "${virtualHost.bucket}.${upstream}";
    proxy_intercept_errors on;
    proxy_pass             "https://${upstream}$uri_path";

    ${virtualHost.forceImageMimeType ? 'proxy_hide_header Content-Type;' : ''}

    proxy_ssl_verify              on;
    proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
  }

  location @fallback {
    ${virtualHost.defaultPath ? `
      rewrite ^ "${virtualHost.defaultPath}";
      set $uri_path "${virtualHost.defaultPath}";
    ` : `
      return 404;
    `}
  }

  location /favicon.ico {
    return 404;
  }
}
`);
}

if (metrics && metrics.enabled) {
  const allow = metrics.allow.map(address => `allow ${address};`).join("\n");
  configBlocks.push(`
    lua_shared_dict prometheus_metrics 10M;

    init_worker_by_lua_block {
      prometheus = require("prometheus").init("prometheus_metrics")

      metric_requests = prometheus:counter(
        "nginx_http_requests_total", "Number of HTTP requests", {"host", "status"})
      metric_latency = prometheus:histogram(
        "nginx_http_request_duration_seconds", "HTTP request latency", {"host"})
      metric_connections = prometheus:gauge(
        "nginx_http_connections", "Number of HTTP connections", {"state"})

      metric_upstream_cache_status = prometheus:counter(
        "nginx_upstream_cache_status", "Number of HTTP requests per upstream cache status", {"host", "status"})
    }

    log_by_lua_block {
      metric_requests:inc(1, {ngx.var.server_name, ngx.var.status})
      metric_latency:observe(tonumber(ngx.var.request_time), {ngx.var.server_name})

      if (ngx.var.upstream_cache_status) then
        metric_upstream_cache_status:inc(1, {ngx.var.server_name, ngx.var.upstream_cache_status})
      end
    }

    server {
      listen ${metrics.port};

      deny all;

      location ${metrics.location} {
        ${allow}

        content_by_lua_block {
          metric_connections:set(ngx.var.connections_reading, {"reading"})
          metric_connections:set(ngx.var.connections_waiting, {"waiting"})
          metric_connections:set(ngx.var.connections_writing, {"writing"})
          prometheus:collect()
        }
      }
    }
  `);
}

fs.writeFileSync("/etc/nginx/conf.d/s3-proxy.conf", configBlocks.join(""));

console.log("Successfully generated config!");
