# syntax=docker/dockerfile:1
# Stage 1: build the static site. VITE_BACKEND_URL is baked in at build time and is the
# address the USER'S BROWSER uses to reach the backend (not a name inside the Compose network).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
ARG VITE_BACKEND_URL=http://localhost:8000
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
RUN npm run build

# Stage 2: serve it. No Node at run time, and nginx runs as a non-root user.
FROM nginxinc/nginx-unprivileged:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
