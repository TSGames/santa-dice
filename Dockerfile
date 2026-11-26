# --- Build Angular app (runs natively on the build host, also for multi-arch) ---
FROM --platform=$BUILDPLATFORM node:18-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx ng build --configuration production

# --- Runtime: Apache + PHP serving static files and api.php ---
FROM php:8.3-apache
ENV DATA_DIR=/data
RUN mkdir -p /data && chown www-data:www-data /data
COPY --from=build /app/dist/santa-dice/ /var/www/html/
VOLUME /data
EXPOSE 80
