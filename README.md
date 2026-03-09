# PDF Semantic Search

PDF Semantic Search est une application desktop local-first qui permet d'importer une bibliothèque de fichiers PDF, d'indexer leur contenu en arrière-plan et de retrouver rapidement les passages les plus utiles grâce à une recherche hybride. L'application combine recherche sémantique, recherche par mots-clés, citations cliquables, aperçu contextuel et assistant local pour aider à explorer des documents sans dépendre d'une API distante.

Le projet est développé par Michael de LM-Code, sur [lm-code.be](https://lm-code.be).

## Pourquoi cette application

PDF Semantic Search répond à un besoin simple : retrouver une information précise dans une bibliothèque de PDF sans perdre du temps à ouvrir les fichiers un par un. L'application est pensée pour les usages documentaires, administratifs, RH, juridiques, comptables, techniques ou internes, avec un positionnement clair :

- fonctionnement local-first
- indexation offline
- données PDF conservées sur la machine
- citations exploitables
- assistant local optionnel

## Fonctionnalités principales

- Import de PDF par sélection de fichiers ou scan récursif d'un dossier.
- Indexation persistante avec reprise après redémarrage.
- Extraction de texte page par page avec OCR optionnel pour les PDF scannés ou partiellement illisibles.
- Découpage intelligent en chunks pour améliorer la qualité de recherche.
- Recherche hybride :
  - mots-clés via SQLite FTS5
  - similarité sémantique via embeddings locaux
- Réponses extractives avec phrases complètes et citations.
- Assistant local avec Ollama en option.
- Ouverture du PDF à la bonne page avec surlignage, contexte, plan, zoom, rotation et navigation.
- Collections, tags, favoris et export des résultats.
- Application Electron prête pour le packaging Windows, macOS et Linux.

## Stack technique

- Electron
- React
- TypeScript
- Vite / electron-vite
- Tailwind CSS
- SQLite via `better-sqlite3`
- PDF.js / react-pdf
- FastAPI
- Sentence Transformers
- Tesseract.js
- Ollama en option

## Architecture du projet

- `src/main` : logique Electron, base SQLite, indexation, recherche, assistant, protocole `pdfdoc://`.
- `src/preload` : API sécurisée exposée au renderer via `contextBridge`.
- `src/renderer` : interface React.
- `src/shared` : modèles partagés et contrats IPC.
- `python` : service local d'embeddings.
- `resources/migrations` : migrations SQLite append-only.
- `scripts` : scripts de rebuild, lancement et diagnostic.

## Installation

### Prérequis

- Node.js 20 ou supérieur
- Python 3.10 ou supérieur

### Installation JavaScript

```powershell
npm install
```

### Installation du service Python

```powershell
cd python
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..
```

## Lancer l'application en développement

```powershell
npm run dev
```

## Vérifications utiles

```powershell
npm run typecheck
npm run test
npm run lint
```

## Build et packaging

```powershell
npm run build
npm run dist
```

## Fonctionnement de la recherche

Le moteur de recherche fonctionne en plusieurs étapes :

1. le texte du PDF est extrait et normalisé
2. le document est découpé en segments cohérents
3. SQLite FTS5 indexe le texte pour les requêtes par mots-clés
4. un service Python génère des embeddings locaux
5. les scores sémantiques et lexicaux sont fusionnés
6. l'interface affiche les meilleurs passages avec citations et contexte

Cette approche améliore la précision, tout en restant exploitable sans cloud externe.

## Assistant local

L'application propose deux modes :

- mode extractif : rapide, déterministe, local et sans dépendance LLM
- mode Ollama : réponses plus riches, toujours locales, avec citations

Sans Ollama, l'application reste parfaitement utilisable.

## OCR et qualité de lecture PDF

PDF Semantic Search gère les PDF texte classiques, mais aussi les documents partiellement scannés. L'application détecte les pages pauvres en texte, peut lancer un OCR ciblé, puis stocke le texte le plus utile pour l'indexation. Le viewer PDF gère aussi les cas bloquants les plus fréquents : erreur de chargement, mot de passe, mauvaise version de worker, zoom, rotation et navigation.

## Cas d'usage

- recherche dans des procédures RH
- exploration de dossiers administratifs
- relecture de documents juridiques
- consultation de rapports techniques
- classement de documentation interne
- exploitation locale de bibliothèques PDF sans SaaS

## Publication et téléchargement

Le dépôt GitHub public peut servir de point de téléchargement, de documentation et de démonstration technique. Pour un site vitrine ou un article, le plus propre est de faire pointer le bouton de téléchargement vers le dépôt GitHub ou vers les Releases GitHub lorsque les builds packagés seront publiés.

## Développement et maintenance

Le projet a été conçu pour rester lisible et évolutif :

- migrations de base append-only
- séparation claire `main / preload / renderer`
- logique métier centralisée dans des services dédiés
- configuration persistante
- validation d'entrées IPC via Zod

## Auteur

Michael  
LM-Code  
[https://lm-code.be](https://lm-code.be)

## Licence

MIT
