FROM node:18-alpine

# Install tzdata for Asia/Jakarta timezone support
RUN apk add --no-cache tzdata
ENV TZ=Asia/Jakarta

WORKDIR /app

# Install dependencies first for caching
COPY package*.json ./
RUN npm ci --only=production

# Copy application source code
COPY . .

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npm", "start"]
