"""CNN + BiLSTM + Transformer seizure-detection network (PyTorch).

Architecture (per the design doc's AI pipeline):
    raw EEG epoch (178 samples)
      -> 1D CNN stack        (local morphological features: spikes, sharp waves)
      -> BiLSTM               (temporal dependencies across the epoch)
      -> Transformer encoder  (self-attention over the LSTM's time steps)
      -> pooled classification head -> seizure probability
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn


class PositionalEncoding(nn.Module):
    def __init__(self, d_model: int, max_len: int = 256):
        super().__init__()
        pe = torch.zeros(max_len, d_model)
        pos = torch.arange(0, max_len, dtype=torch.float32).unsqueeze(1)
        div = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(pos * div)
        pe[:, 1::2] = torch.cos(pos * div)
        self.register_buffer("pe", pe.unsqueeze(0))

    def forward(self, x):
        return x + self.pe[:, : x.size(1)]


class SeizureNet(nn.Module):
    def __init__(self, cnn_channels: int = 32, lstm_hidden: int = 48, n_heads: int = 4):
        super().__init__()
        self.cnn = nn.Sequential(
            nn.Conv1d(1, cnn_channels, kernel_size=7, padding=3),
            nn.BatchNorm1d(cnn_channels),
            nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Conv1d(cnn_channels, cnn_channels * 2, kernel_size=5, padding=2),
            nn.BatchNorm1d(cnn_channels * 2),
            nn.ReLU(),
            nn.MaxPool1d(2),
        )
        cnn_out_dim = cnn_channels * 2
        self.lstm = nn.LSTM(
            input_size=cnn_out_dim, hidden_size=lstm_hidden, batch_first=True, bidirectional=True
        )
        d_model = lstm_hidden * 2
        self.pos_enc = PositionalEncoding(d_model)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=n_heads, dim_feedforward=d_model * 2,
            batch_first=True, dropout=0.1,
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=1)
        self.head = nn.Sequential(
            nn.Linear(d_model, 32), nn.ReLU(), nn.Dropout(0.2), nn.Linear(32, 1)
        )

    def forward(self, x):
        # x: (batch, 178) raw EEG epoch
        x = x.unsqueeze(1)               # (batch, 1, 178)
        x = self.cnn(x)                  # (batch, channels, T')
        x = x.transpose(1, 2)            # (batch, T', channels)
        x, _ = self.lstm(x)              # (batch, T', 2*hidden)
        x = self.pos_enc(x)
        x = self.transformer(x)          # (batch, T', 2*hidden)
        x = x.mean(dim=1)                # global average pool over time
        return self.head(x).squeeze(-1)  # (batch,) logits
