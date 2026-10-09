FROM node:22-alpine

WORKDIR /workspace
COPY . .
RUN npm ci --workspace=@fleet-pulse/backend --include-workspace-root=false

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "@fleet-pulse/backend"]