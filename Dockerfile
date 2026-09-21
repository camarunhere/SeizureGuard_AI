# Backend image for Render: Node (Express API) + Python (ML service spawned by Node).
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps (CPU-only torch keeps the image small)
COPY requirements.txt ./
RUN python3 -m venv .venv \
    && .venv/bin/pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && .venv/bin/pip install --no-cache-dir -r requirements.txt

# Node deps
COPY server/package*.json server/
RUN npm ci --omit=dev --prefix server

# App code + trained models (data/ is only needed for training)
COPY src ./src
COPY models ./models
COPY server ./server

WORKDIR /app/server
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
