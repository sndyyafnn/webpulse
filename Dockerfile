FROM node:18-alpine

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm ci --only=production

# Copy application source code
COPY . .

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npm", "start"]
