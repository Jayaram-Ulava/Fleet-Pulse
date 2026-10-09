FROM node:22-alpine AS build

WORKDIR /workspace
COPY . .
RUN npm ci --workspace=@fleet-pulse/frontend --include-workspace-root=false
RUN npm run build --workspace=@fleet-pulse/frontend

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/frontend/dist/Fleet-Pulse/browser /usr/share/nginx/html
EXPOSE 80