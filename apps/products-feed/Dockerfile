FROM node:24-alpine
RUN npm install -g pnpm@10.28.1
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter saleor-app-products-feed build
EXPOSE 3000
CMD ["pnpm", "--filter", "saleor-app-products-feed", "start"]
