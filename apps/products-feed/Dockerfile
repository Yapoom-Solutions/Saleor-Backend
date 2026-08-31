FROM node:24-alpine
RUN npm install -g pnpm@10.28.1
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN SECRET_KEY=buildtime_temp_key_placeholder REQUEST_SECRET=buildtime_temp_secret_placeholder pnpm --filter saleor-app-products-feed build
EXPOSE 3000
CMD ["pnpm", "--filter", "saleor-app-products-feed", "start"]
