FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

# Install system deps needed by newspaper3k / lxml
RUN apt-get update && apt-get install -y \
    gcc \
    libxml2-dev \
    libxslt-dev \
    libffi-dev \
    libssl-dev \
    libjpeg-dev \
    zlib1g-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Pre-download NLTK data so it's baked into the image
RUN python -c "import nltk; nltk.download('punkt'); nltk.download('stopwords')"

COPY backend ./backend

EXPOSE 8000

CMD ["python", "backend/main.py"]