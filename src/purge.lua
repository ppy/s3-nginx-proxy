-- source: https://github.com/orangle/openresty-proxy-purge-example/blob/master/purge_item/purge.lua
--
-- Tit Petric, Monotek d.o.o., Thu 27 Oct 2016 10:43:38 AM CEST
--
-- Delete nginx cached assets with a PURGE request against an endpoint
--

local md5 = ngx.md5
local httpc = require("resty.http").new()
httpc:set_timeout(5000)

local function file_exists(name)
        local f = io.open(name, "r")
        if f~=nil then io.close(f) return true else return false end
end

local function explode(d, p)
        local t, ll
        t={}
        ll=0
        if(#p == 1) then return {p} end
                while true do
                        local l=string.find(p, d, ll, true) -- find the next d in the string
                        if l~=nil then -- if "not not" found then..
                                table.insert(t, string.sub(p, ll, l-1)) -- Save it in our array.
                                ll=l+1 -- save just after where we found it for searching next time.
                        else
                                table.insert(t, string.sub(p, ll)) -- Save what's left in our array.
                                break -- Break at end, as it should be, according to the lua manual.
                        end
                end
        return t
end

local function cache_filename(cache_path, cache_levels, cache_key)
        local md5sum = md5(cache_key)
        local levels = explode(":", cache_levels)
        local filename = ""

        local index = string.len(md5sum)
        for k, v in pairs(levels) do
                local length = tonumber(v)
                -- add trailing [length] chars to index
                index = index - length;
                filename = filename .. md5sum:sub(index+1, index+length) .. "/";
        end
        if cache_path:sub(-1) ~= "/" then
                cache_path = cache_path .. "/";
        end
        filename = cache_path .. filename .. md5sum
        return filename
end

local function purge(filename)
        if (file_exists(filename)) then
                os.remove(filename)
        end
end

if ngx ~= nil then
        if ngx.var.lua_purge_authorization_key ~= ngx.var.http_authorization then
                ngx.status = ngx.HTTP_UNAUTHORIZED
                ngx.say("UNAUTHORIZED")
        else
                local filename = cache_filename(ngx.var.lua_purge_path, ngx.var.lua_purge_levels, ngx.var.lua_purge_cache_key)
                purge(filename)

                if ngx.var.lua_purge_cloudflare_zoneid ~= "" and ngx.var.lua_purge_cloudflare_apitoken ~= "" then
                        local headers = { ["Authorization"] = "Bearer " .. ngx.var.lua_purge_cloudflare_apitoken, ["Content-Type"] = "application/json" }
                        local url = "https://" .. ngx.var.host .. ngx.var.request_uri
                        local body = "{\"files\":[\"" .. url:gsub("\"", "\\\"") .. "\"]}"
                        local res, err = httpc:request_uri("https://api.cloudflare.com/client/v4/zones/" .. ngx.var.lua_purge_cloudflare_zoneid .. "/purge_cache", { method = "DELETE", headers = headers, body = body })
                        if not res then
                                ngx.log(ngx.ERR, "request for purging " .. url .. " failed: ", err)
                        elseif res.status ~= 200 then
                                ngx.log(ngx.ERR, "request for purging " .. url .. " failed (" .. res.status .. "): " .. res.status, res.body)
                        end
                end

                ngx.status = ngx.HTTP_OK
                ngx.say("OK")
        end
end
