# Architecture

This document outlines the system design and architecture of DirStudio.

---

## 🧠 Overview

DirStudio follows a **client-server architecture** with a clear separation between the frontend UI, backend processing, and external AI services.

```
Frontend (Client UI)
↓
Backend (FastAPI Server)
↓
File System + Database
↓
AI Layer (Mistral via LangChain)
```


---

## 🧩 Core Components

### 1. Frontend (Client)

**Location:** `dirstudio/client/`

- Built using Vanilla JavaScript and Bootstrap
- Uses Chart.js for data visualization
- Communicates with backend via REST APIs

#### Responsibilities:
- Render UI and dashboards
- Display analytics and charts
- Handle user interactions (scan, delete, organize)

---

### 2. Backend (Server)

**Location:** `dirstudio/server/src/`

- Built with Python (FastAPI or similar framework)
- Core logic for scanning, analysis, and AI integration

#### Responsibilities:
- Directory scanning and file metadata extraction
- Duplicate detection (hash-based)
- Data aggregation and statistics
- API endpoint handling
- AI integration for organization

---

### 3. File System Layer

- Direct interaction with the user's local filesystem
- Reads file structure, sizes, and metadata
- Performs file operations (e.g., deletion)

---

### 4. Database Layer

- Stores scan results and processed metadata
- Enables faster retrieval without re-scanning

#### Stores:
- File paths
- File sizes
- Hash values (for duplicate detection)
- Scan summaries

---

### 5. AI Layer

- Integrated using **LangChain + Mistral AI**
- Provides intelligent file organization suggestions

#### Responsibilities:
- Analyze file names and structure
- Suggest directory reorganization
- Assist in automation workflows

---

## 🔄 Data Flow

### 1. Scan Initiation

User selects a directory via the frontend.

---

### 2. Backend Processing

- Files are recursively scanned
- Metadata is collected
- Hashes are computed for duplicate detection

---

### 3. Data Storage

- Results are stored in the database
- Enables reuse without repeated scans

---

### 4. Analysis

Backend computes:
- File counts
- Size distribution
- File type grouping
- Duplicate clusters

---

### 5. API Response

Processed data is sent to the frontend via REST endpoints.

---

### 6. Visualization

Frontend renders:
- Charts (file types, storage usage)
- Lists (duplicates, extensions)
- Summary cards

---

### 7. AI Processing (Optional)

- Selected data is sent to the AI layer
- Suggestions are generated and returned

---

## 🔌 API Communication

- REST-based communication
- JSON request/response format

Example flow:

```
Frontend → GET /overview/{scan_id}
Backend → Returns aggregated data
```

---

## ⚙️ Configuration Management

- Environment variables stored in `.env`
- Loaded at backend startup (`main.py`)

---

## 🧱 Design Principles

- **Separation of concerns** (UI vs logic vs AI)
- **Modularity** (independent components)
- **Scalability** (can extend features easily)
- **Local-first processing** (privacy-focused)

---

## 🚧 Known Architectural Limitations

- No real-time file system monitoring (yet)
- Single-user local environment (no multi-user support *yet*)

---

## 🚀 Future Improvements

- Real-time filesystem watchers
- Incremental scanning (diff-based updates)
- Background task queue for heavy operations
- Microservice separation (AI, scanning, API)
- Cloud sync support

---

## 🧠 Summary

DirStudio is designed as a modular, extensible system that combines:

- File system analysis  
- Data visualization  
- AI-powered insights  

into a cohesive developer-grade tool.
