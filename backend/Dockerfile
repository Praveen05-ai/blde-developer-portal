# Use standard LTS Node.js slim alpine image for high security and performance
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci

COPY . .

# Production image stage
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

COPY package*.json ./

# Only install production dependencies for compact and secure image
RUN npm ci --only=production

COPY --from=builder /usr/src/app/src ./src
COPY --from=builder /usr/src/app/knexfile.js ./
COPY --from=builder /usr/src/app/db ./db
COPY --from=builder /usr/src/app/config ./config
COPY --from=builder /usr/src/app/frontend ./frontend


EXPOSE 3001

ENV NODE_ENV=production

CMD ["npm", "run", "start"]
