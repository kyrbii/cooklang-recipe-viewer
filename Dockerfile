# The app: built with Node, served as static files by nginx.
# The image is the same for every server: the API URL comes from the API_URL environment
# variable when the container starts (docker/40-stir-config.sh writes it into config.js).

# The build output is plain HTML/JS, so it is built once on the build machine's platform
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.29-alpine
# Filled in at container start from API_URL (for the CSP)
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 docker/40-stir-config.sh /docker-entrypoint.d/40-stir-config.sh
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
