FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_REOWN_PROJECT_ID
ARG VITE_ROBINHOOD_CHAIN
ARG BUILD_ID=dev
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_REOWN_PROJECT_ID=$VITE_REOWN_PROJECT_ID
ENV VITE_ROBINHOOD_CHAIN=$VITE_ROBINHOOD_CHAIN
ENV VITE_BUILD_ID=$BUILD_ID
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ARG BUILD_ID=dev
ENV NODE_ENV=production
ENV PORT=8080
ENV BUILD_ID=$BUILD_ID
COPY package.json package-lock.json ./
RUN npm ci
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY missions ./missions
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/ready || exit 1
CMD ["npm", "run", "server"]
