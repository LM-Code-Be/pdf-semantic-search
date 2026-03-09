# Embeddings service (local)

Ce micro-service tourne en local (127.0.0.1) et fournit `/embed` pour générer des embeddings via `sentence-transformers`.

## Setup
- `python -m venv .venv`
- `.venv\\Scripts\\activate` (Windows) ou `source .venv/bin/activate`
- `pip install -r requirements.txt`
- `set EMBEDDINGS_PORT=17831` (optionnel)
- `set EMBEDDINGS_MODEL=sentence-transformers/all-MiniLM-L6-v2` (optionnel)
- `python server.py`

## Offline strict
Pour éviter tout téléchargement de modèle, pré-téléchargez le modèle dans un dossier et définissez:
- `EMBEDDINGS_MODEL_PATH=chemin/vers/model`

