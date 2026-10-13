#!/bin/sh
# Runs at container start (nginx image entrypoint): writes the API URL into config.js,
# which the app loads before it starts. This way the prebuilt image works for any server.
set -eu

if [ -z "${API_URL:-}" ]; then
    echo "stir: API_URL is not set (e.g. API_URL=https://api.example.com)" >&2
    exit 1
fi

# Only plain http(s) URLs: the value ends up inside a script and in the CSP header
if ! printf '%s' "$API_URL" | grep -Eq '^https?://[A-Za-z0-9._~:/?#@!$&()*+,=%-]+$'; then
    echo "stir: API_URL is not a valid http(s) URL: $API_URL" >&2
    exit 1
fi

printf 'window.STIR_CONFIG = { apiUrl: "%s" };\n' "$API_URL" > /usr/share/nginx/html/config.js
echo "stir: API_URL=$API_URL"
