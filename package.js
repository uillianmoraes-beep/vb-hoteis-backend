{
  "name": "vb-hoteis-backend",
  "version": "1.0.0",
  "description": "Backend API para gestao hoteleira e motéis",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "ts-node-dev --respawn --transpile-only src/server.ts"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "pg": "^8.11.5"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.12.7",
    "@types/pg": "^8.11.5",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.4.5"
  }
}
