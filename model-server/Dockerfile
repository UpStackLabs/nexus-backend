FROM python:3.11-slim

WORKDIR /app

# Install system dependencies needed by torch / Pillow
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libgomp1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download models during image build so container startup is fast
# (both models are cached into HuggingFace's default cache directory)
RUN python - <<'EOF'
import logging
logging.basicConfig(level=logging.INFO)

print("Pre-downloading sentence-transformers/all-MiniLM-L6-v2 ...")
from sentence_transformers import SentenceTransformer
SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
print("Embedding model cached.")

print("Pre-downloading facebook/bart-large-mnli ...")
from transformers import pipeline
pipeline("zero-shot-classification", model="facebook/bart-large-mnli", device=-1)
print("Zero-shot classification model cached.")
EOF

COPY . .

EXPOSE 8002

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
