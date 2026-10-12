# The app: built with Node, served as static files by nginx.
# The API URL is baked into the build, so pass the public one:
#   docker build --build-arg VITE_API_URL=https://api.example.com .

FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
RUN test -n "$VITE_API_URL" || (echo "VITE_API_URL build argument is required" && exit 1)
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.29-alpine
# Filled in at container start from the API_ORIGIN environment variable (for the CSP)
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
