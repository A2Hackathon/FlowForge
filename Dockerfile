# FlowForge: static Vite/React frontend for Cloud Run (Electron app is not containerized here).
# Cloud Run sets PORT; listen on 0.0.0.0.

FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=frontend-build /app/frontend/dist ./dist
ENV PORT=8080
EXPOSE 8080
# serve: single-page app, bind all interfaces, use Cloud Run's PORT
CMD ["sh", "-c", "serve -s dist -l tcp://0.0.0.0:${PORT}"]
