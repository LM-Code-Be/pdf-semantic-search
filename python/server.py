import os
from threading import Lock
from typing import List, Optional, TYPE_CHECKING

from fastapi import FastAPI
from pydantic import BaseModel

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer

APP_PORT = int(os.environ.get("EMBEDDINGS_PORT", "17831"))
MODEL_NAME = os.environ.get("EMBEDDINGS_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
MODEL_PATH = os.environ.get("EMBEDDINGS_MODEL_PATH", "").strip() or None
MODEL_DEVICE = os.environ.get("EMBEDDINGS_DEVICE", "cpu").strip() or "cpu"

LLM_MODEL = os.environ.get("LLM_MODEL", "google/flan-t5-small")
LLM_MODEL_PATH = os.environ.get("LLM_MODEL_PATH", "").strip() or None
LLM_MAX_SOURCES = int(os.environ.get("LLM_MAX_SOURCES", "14"))
LLM_SOURCE_CHARS = int(os.environ.get("LLM_SOURCE_CHARS", "900"))

app = FastAPI(title="PDF Semantic Search - Embeddings")

_model: Optional["SentenceTransformer"] = None
_model_lock = Lock()
_llm_pipe = None


class EmbedRequest(BaseModel):
    texts: List[str]


class EmbedResponse(BaseModel):
    model: str
    dim: int
    embeddings: List[List[float]]


@app.get("/health")
def health():
    return {"ok": True, "model_loaded": _model is not None, "model": MODEL_NAME, "model_path": MODEL_PATH}


def get_model() -> "SentenceTransformer":
    global _model
    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:
            return _model

        # On charge lourdement ici pour garder /health léger.
        from sentence_transformers import SentenceTransformer

        model_id = MODEL_PATH if MODEL_PATH is not None else MODEL_NAME
        _model = SentenceTransformer(model_id, device=MODEL_DEVICE)
    return _model


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    model = get_model()
    vecs = model.encode(req.texts, normalize_embeddings=True, batch_size=32, show_progress_bar=False)
    embeddings = vecs.tolist()
    dim = len(embeddings[0]) if embeddings else 0
    return {"model": MODEL_NAME if MODEL_PATH is None else MODEL_PATH, "dim": dim, "embeddings": embeddings}


class LlmSource(BaseModel):
    id: int
    doc_name: str
    page_start: int
    page_end: int
    text: str


class LlmBulletsRequest(BaseModel):
    question: str
    sources: List[LlmSource]
    max_bullets: int = 6
    language: str = "fr"


class LlmBulletsResponse(BaseModel):
    ok: bool
    model: str
    bullets: List[str]
    keywords: List[str]
    llm_loaded: bool


def _extract_keywords_fallback(text: str) -> List[str]:
    stop = {
        "le",
        "la",
        "les",
        "un",
        "une",
        "des",
        "de",
        "du",
        "d",
        "et",
        "ou",
        "en",
        "dans",
        "pour",
        "par",
        "avec",
        "sans",
        "sur",
        "au",
        "aux",
        "ce",
        "cet",
        "cette",
        "ces",
        "qui",
        "que",
        "quoi",
        "dont",
        "où",
        "a",
        "à",
        "est",
        "sont",
        "être",
        "avoir",
        "plus",
        "moins",
        "très",
        "comme",
        "il",
        "elle",
        "ils",
        "elles",
        "on",
        "nous",
        "vous",
        "je",
        "tu",
    }
    words = []
    for w in text.lower().replace("\n", " ").split(" "):
        w = "".join(ch for ch in w if ch.isalnum() or ch in ("-", "_"))
        if len(w) < 4:
            continue
        if w in stop:
            continue
        words.append(w)
    freq = {}
    for w in words:
        freq[w] = freq.get(w, 0) + 1
    top = sorted(freq.items(), key=lambda x: (-x[1], x[0]))[:8]
    return [w for (w, _n) in top]


def get_llm_pipe():
    global _llm_pipe
    if _llm_pipe is not None:
        return _llm_pipe

    try:
        import sentencepiece  # noqa: F401
    except Exception as e:
        raise RuntimeError(
            "Missing Python dependency 'sentencepiece'. Install it in python/.venv: pip install sentencepiece"
        ) from e

    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer, pipeline

    model_id = LLM_MODEL_PATH if LLM_MODEL_PATH is not None else LLM_MODEL
    tok = AutoTokenizer.from_pretrained(model_id)
    mdl = AutoModelForSeq2SeqLM.from_pretrained(model_id)
    _llm_pipe = pipeline("text2text-generation", model=mdl, tokenizer=tok, device=-1)
    return _llm_pipe


def _parse_bullets(text: str, max_bullets: int) -> List[str]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    bullets = []
    for ln in lines:
        if ln.startswith(("-", "•", "–", "*")):
            ln = ln.lstrip("-•–*").strip()
        if len(ln) < 10:
            continue
        bullets.append(ln)
        if len(bullets) >= max_bullets:
            break
    if bullets:
        return bullets
    # Repli simple si le texte n'est pas structuré.
    parts = [p.strip() for p in text.replace("\n", " ").split(". ") if p.strip()]
    return [p[:320] for p in parts[:max_bullets]]


@app.get("/llm/health")
def llm_health():
    return {
        "ok": True,
        "llm_loaded": _llm_pipe is not None,
        "model": LLM_MODEL,
        "model_path": LLM_MODEL_PATH,
    }


@app.post("/llm/bullets", response_model=LlmBulletsResponse)
def llm_bullets(req: LlmBulletsRequest):
    question = (req.question or "").strip()
    if not question:
        question = "Résume le document."

    sources = (req.sources or [])[: max(1, min(LLM_MAX_SOURCES, 30))]
    sources_txt = []
    for s in sources[:LLM_MAX_SOURCES]:
        t = (s.text or "").strip().replace("\n", " ")
        if len(t) > LLM_SOURCE_CHARS:
            t = t[:LLM_SOURCE_CHARS] + "…"
        sources_txt.append(f"[S{s.id}] ({s.doc_name}, p.{s.page_start}-{s.page_end}) {t}")

    prompt = (
        "Tu es un assistant. Réponds en français.\n"
        "Tâche: produire une réponse claire et précise sous forme de puces.\n"
        "Règles:\n"
        "- Utilise uniquement les informations des sources.\n"
        "- Ne cite pas de pages dans le texte (les citations sont gérées ailleurs).\n"
        f"- Donne au maximum {req.max_bullets} puces.\n\n"
        f"Question: {question}\n\n"
        "Sources:\n"
        + "\n".join(sources_txt)
        + "\n\nRéponse:\n"
    )

    bullets: List[str] = []
    keywords: List[str] = []
    model_id = LLM_MODEL_PATH if LLM_MODEL_PATH is not None else LLM_MODEL
    try:
        pipe = get_llm_pipe()
        out = pipe(prompt, max_new_tokens=256, do_sample=False, num_beams=2)
        gen = out[0].get("generated_text", "").strip() if out else ""
        bullets = _parse_bullets(gen, max(1, min(req.max_bullets, 10)))
        joined = " ".join(bullets)
        keywords = _extract_keywords_fallback(joined)
        return {"ok": True, "model": str(model_id), "bullets": bullets, "keywords": keywords, "llm_loaded": True}
    except Exception:
        # Repli extractif si le LLM local échoue.
        extract = " ".join(x.text for x in sources if x.text)[:4000]
        keywords = _extract_keywords_fallback(extract)
        # On garde les premiers passages utiles.
        for s in sources[: req.max_bullets]:
            t = (s.text or "").strip().replace("\n", " ")
            if not t:
                continue
            bullets.append(t[:240].strip() + ("…" if len(t) > 240 else ""))
        return {"ok": True, "model": str(model_id), "bullets": bullets[: req.max_bullets], "keywords": keywords, "llm_loaded": False}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=APP_PORT, log_level="info")
