# Backend image for Render: Node (Express API) + Python (ML service spawned by Node).
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps. torch is pinned to the version the model was trained with (2.2.2)
# and pulled from the CPU wheel index (PyPI stays available for its dependencies).
COPY requirements.txt ./
RUN python3 -m venv .venv \
    && .venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
    && .venv/bin/pip install --no-cache-dir --prefer-binary \
       --extra-index-url https://download.pytorch.org/whl/cpu "torch==2.2.2" \
    && .venv/bin/pip install --no-cache-dir --prefer-binary -r requirements.txt

# Node deps
COPY server/package*.json server/
RUN npm ci --omit=dev --prefix server

# App code + trained models. eeg_seizure_raw.csv is also needed at runtime
# (not just training) — it backs the /simulate endpoint's sample EEG+vitals
# pool for Live Monitoring; without it the ML service loads fine but
# /simulate fails with "Simulation data not loaded."
COPY src ./src
COPY models ./models
COPY data/eeg_seizure_raw.csv ./data/eeg_seizure_raw.csv
COPY server ./server

WORKDIR /app/server
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
