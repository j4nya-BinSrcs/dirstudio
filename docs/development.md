# Development Guide

This document is the primary reference for contributors working on DirStudio. It covers the repository layout, development environment setup, current implementation status, active work areas, and contribution guidelines.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Repository Structure](#repository-structure)
- [Development Environment](#development-environment)
- [Tech Stack](#tech-stack)
- [Current Implementation Status](#current-implementation-status)
- [Codebase Walkthrough](#codebase-walkthrough)
- [Running in Development Mode](#running-in-development-mode)
- [Testing](#testing)
- [Contribution Guidelines](#contribution-guidelines)
- [Roadmap](#roadmap)
- [Known Issues & Limitations](#known-issues--limitations)

---

## Project Overview

DirStudio is a full-stack local application for directory intelligence — scanning filesystems, detecting duplicate files, visualizing storage composition, and generating AI-assisted organization suggestions. It is composed of:

- A **Python FastAPI backend** (`dirstudio/server/`) that handles all scanning, hashing, and AI logic.
- A **Vanilla JS + Bootstrap frontend** (`dirstudio/client/`) that provides the interactive dashboard.

The two communicate over a local REST API. There is no cloud component — all processing happens on the user's machine.

---

## Repository Structure

```
dirstudio/                         ← Project root
├── dirstudio/
│   ├── client/                    ← Frontend (Vanilla JS, Bootstrap, Chart.js)
│   │   ├── public/                ← Static assets (HTML, CSS)
│   │   └── src/                   ← JavaScript source files
│   └── server/                    ← Backend (Python, FastAPI)
│       ├── core/
│       │   ├── main.py            ← FastAPI app entry point; all route definitions
│       │   ├── services/
│       │   │   ├── scanning.py    ← Filesystem walker and metadata collector
│       │   │   └── hashing.py     ← SHA-256 duplicate detection logic
│       │   └── utils/
│       │       ├── filesystem.py  ← Low-level filesystem helpers
│       │       └── metadata.py    ← File metadata extraction utilities
│       ├── pyproject.toml         ← Python project config and dependencies
│       ├── .python-version        ← Pinned Python version (used by uv)
│       └── .env                   ← API keys (not committed — create manually)
├── docs/                          ← All documentation lives here
├── launch.sh                      ← One-command launch for Linux/macOS
├── launch.bat                     ← One-command launch for Windows
└── README.md
```

### Key Files to Know

| File | Purpose |
|---|---|
| `server/core/main.py` | All FastAPI routes are defined here. Start here to understand or add API endpoints. |
| `server/core/services/scanning.py` | The directory walker. Handles recursive filesystem traversal and metadata collection. |
| `server/core/services/hashing.py` | SHA-256 hashing for exact duplicate detection. Groups files by hash. |
| `server/core/utils/filesystem.py` | Helpers for safe path resolution, permission checks, and file I/O. |
| `server/core/utils/metadata.py` | Extracts file metadata: size, MIME type, modified time, extension. |
| `client/src/` | Frontend JavaScript. Handles API calls, chart rendering, and UI interactions. |

---

## Development Environment

### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Python | 3.13+ | Backend runtime |
| uv | Latest | Python package management (replaces pip/venv) |
| Node.js | Any modern | Only needed if you modify frontend dependencies |
| Git | Any | Version control |

DirStudio uses [`uv`](https://github.com/astral-sh/uv) for dependency management. It handles virtual environment creation and package resolution automatically.

### First-Time Setup

```bash
# Clone the repository
git clone https://github.com/j4nya-BinSrcs/dirstudio.git
cd dirstudio

# Install backend dependencies (uv creates the venv automatically)
cd dirstudio/server
uv sync

# Create the environment file
echo "MISTRAL_API_KEY=your_key_here" > .env
```

> The `.env` file must be at `dirstudio/server/.env`. Without it, the AI organization feature will fail, but all other features work normally.

---

## Tech Stack

### Backend

| Component | Technology |
|---|---|
| Framework | FastAPI |
| Runtime | Python 3.13 |
| Package manager | uv |
| Linter | Ruff |
| Test runner | pytest + pytest-asyncio |
| Hashing | `hashlib` (stdlib SHA-256) |
| Image hashing | `imagehash` (planned) |
| AI integration | LangChain + Mistral AI |

### Frontend

| Component | Technology |
|---|---|
| UI framework | Vanilla JavaScript + Bootstrap |
| Charts | Chart.js |
| Communication | Fetch API (REST/JSON) |

### Development Tools

| Tool | Purpose |
|---|---|
| Ruff | Linting and formatting (replaces flake8 + black) |
| pytest | Unit and integration testing |
| pytest-asyncio | Testing async FastAPI endpoints |
| Pygments | Syntax highlighting in CLI output (if applicable) |

---

## Current Implementation Status

This section reflects the current state of the codebase as of the latest commits. Use it to orient yourself before picking up work.

### ✅ Implemented and Working

- **Directory scanning** — Recursive filesystem walk, metadata extraction (path, size, MIME type, extension, modification time).
- **SHA-256 exact duplicate detection** — Files are hashed in streaming chunks. Duplicates are grouped by hash.
- **Overview analytics** — File counts, total size, file type distribution, extension frequency.
- **REST API** — FastAPI server exposing scan, overview, duplicates, delete, and organize endpoints.
- **Frontend dashboard** — Tab-based UI with pie/bar chart visualizations for file type distribution.
- **Duplicate management UI** — Lists duplicate groups, shows reclaimable storage, supports bulk deletion.
- **AI organization suggestions** — Sends scan metadata to Mistral via LangChain and returns structured suggestions.
- **Launch scripts** — `launch.sh` and `launch.bat` start both servers with a single command.

### 🚧 In Progress / Partially Implemented

- **Scan progress feedback** — The backend processes synchronously. The frontend has no real-time progress indicator during large scans. WebSocket-based progress updates are planned.
- **Near-duplicate image detection** — The project design includes perceptual hashing (pHash/dHash via `imagehash`) and BK-tree indexing, but this is not yet wired into the active scanning pipeline.
- **Near-duplicate document detection** — MinHash + LSH for text similarity is designed (see `Deep_Scan.pdf` in project docs) but not yet implemented.
- **Database persistence** — Scan results currently live in-memory for the server session. A PostgreSQL + pgvector layer is designed but not yet integrated.

### 📋 Designed but Not Yet Started

- Semantic similarity search (embedding vectors + pgvector/FAISS)
- Scheduled / incremental scanning
- File preview generation
- Cloud connector support (S3, Google Drive)
- Multi-user support
- Snapshot and rollback system
- OCR for scanned documents

---

## Codebase Walkthrough

### How a Scan Works

1. The frontend POSTs to `POST /scan` with a directory path.
2. `main.py` receives the request and calls the scanning service.
3. `scanning.py` walks the directory recursively using `os.walk` (or equivalent), collecting file paths.
4. For each file, `metadata.py` extracts size, MIME type, extension, and modification time.
5. `hashing.py` computes SHA-256 over each file's bytes in streaming chunks (8 KB at a time) to handle large files.
6. Results are aggregated and stored in memory, keyed by a generated `scan_id`.
7. The API returns the `scan_id` and summary statistics to the frontend.

### How Duplicate Detection Works

- All files are grouped by their SHA-256 hash.
- Any hash that appears more than once indicates exact binary duplicates.
- Groups with `count > 1` are returned by `GET /duplicates/{scan_id}`.
- The reclaimable storage is computed as `(count - 1) * size_bytes` per group.

### How AI Organization Works

- When `POST /organize` is called, the backend retrieves the scan's metadata (file names, types, paths, sizes).
- This metadata — **not file content** — is serialized and sent to the Mistral AI model via LangChain.
- The model returns free-form suggestions, which are parsed and structured before being returned to the client.

---

## Running in Development Mode

For active development, run the backend and frontend separately rather than using the launch scripts. This gives you hot-reloading and cleaner error output.

### Backend (with hot reload)

```bash
cd dirstudio/server
uv run uvicorn core.main:app --reload --port 8000
```

Changes to any Python file in `core/` will automatically restart the server.

### Frontend (development)

The frontend is plain HTML/CSS/JS — no build step required. Simply open `dirstudio/client/public/index.html` in a browser, or serve it with any static file server:

```bash
# Using Python's built-in server (from the client directory)
cd dirstudio/client/public
python -m http.server 3000
```

### Linting

DirStudio uses **Ruff** for linting and formatting. Run it from the server directory:

```bash
cd dirstudio/server

# Check for issues
uv run ruff check .

# Auto-fix issues
uv run ruff check . --fix

# Format code
uv run ruff format .
```

Ruff configuration is defined in `pyproject.toml`.

---

## Testing

Tests live in `dirstudio/server/tests/` (currently being built out). The test framework is **pytest** with **pytest-asyncio** for async endpoint testing.

### Running Tests

```bash
cd dirstudio/server
uv run pytest
```

### Test Coverage Areas (current and planned)

| Area | Status |
|---|---|
| SHA-256 hashing correctness | Planned |
| Filesystem walker (empty dirs, symlinks, permission errors) | Planned |
| Duplicate grouping logic | Planned |
| API endpoint integration tests | Planned |
| Metadata extraction accuracy | Planned |

> Tests are a high-priority contribution area. If you're new to the codebase, writing tests for existing services is a great first contribution.

---

## Contribution Guidelines

### Getting Started

1. Fork the repository on GitHub.
2. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. Make your changes. Follow the code style (Ruff-formatted, typed where practical).
4. Run the linter before committing:
   ```bash
   uv run ruff check . && uv run ruff format .
   ```
5. Open a pull request against `main` with a clear description of what you changed and why.

### Code Style

- **Python:** Follow PEP 8. Ruff enforces this automatically.
- **Type hints:** Use them on all function signatures in `core/`.
- **Docstrings:** Add a one-line docstring to every public function.
- **Frontend JS:** Keep functions small and well-named. No external framework dependencies — stay with Vanilla JS.

### Branch Naming

| Prefix | Use for |
|---|---|
| `feature/` | New functionality |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `refactor/` | Code restructuring without behavior change |
| `test/` | Adding or fixing tests |

### Commit Messages

Write clear, imperative commit messages:

```
Add perceptual hashing for near-duplicate image detection
Fix streaming hash computation for files over 2GB
Refactor scanning service to use async file I/O
```

---

## Roadmap

The following features are planned in rough priority order. Contributors are welcome to pick up any of these.

### Near-Term (High Priority)

- [ ] **Real-time scan progress** — WebSocket endpoint streaming progress percentage to the frontend during large scans.
- [ ] **Near-duplicate image detection** — Wire in `imagehash` (pHash) with BK-tree indexing. Threshold tuning UI in the dashboard.
- [ ] **Unit test suite** — Cover `scanning.py`, `hashing.py`, and API endpoints.
- [ ] **Scan result persistence** — SQLite or PostgreSQL to retain results across server restarts.

### Medium-Term

- [ ] **Near-duplicate document detection** — MinHash + LSH via `datasketch` for text similarity.
- [ ] **Advanced file filtering** — Filter scan results by size range, date range, MIME type.
- [ ] **File preview** — Thumbnail generation for images, first-page preview for PDFs.
- [ ] **Fuzzy filename search** — Search files within a scan by approximate name.

### Longer-Term

- [ ] **Semantic similarity search** — Embedding-based clustering with pgvector or FAISS.
- [ ] **Incremental scanning** — Diff-based re-scans that only process changed files.
- [ ] **Scheduled scans** — Background scanning on a user-defined schedule.
- [ ] **Export reports** — Export scan results and duplicate reports to CSV/JSON/PDF.
- [ ] **Cloud connectors** — Scan S3 buckets and Google Drive alongside local directories.
- [ ] **Bulk file operations** — Move, archive (zip/tar), and rename files from the dashboard.

---

## Known Issues & Limitations

| Issue | Impact | Notes |
|---|---|---|
| No real-time progress during scan | UX — large directories appear frozen | WebSocket implementation planned |
| Scan results lost on server restart | UX — must re-scan | Database persistence is the fix |
| No authentication on API | Security — do not expose port 8000 externally | Intended for local use only |
| Large directory scan performance | Performance — 50k+ files can be slow | Async I/O and parallel hashing planned |
| AI suggestions quality varies | Feature — depends on Mistral response | Prompt engineering improvements ongoing |
| Frontend has no error state handling | UX — network errors fail silently | Frontend error boundaries planned |