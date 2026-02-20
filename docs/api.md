# API Reference

DirStudio exposes a REST API served by the FastAPI backend. All endpoints accept and return JSON. The server runs on `http://localhost:8000` by default.

---

## Base URL

```
http://localhost:8000
```

Interactive API docs (provided by FastAPI automatically) are available at:

- **Swagger UI:** `http://localhost:8000/docs`
- **ReDoc:** `http://localhost:8000/redoc`

---

## General Conventions

| Convention | Detail |
|---|---|
| Format | JSON (`Content-Type: application/json`) |
| Path parameters | Enclosed in `{braces}` |
| Error responses | Standard HTTP status codes with a `detail` field |
| Scan ID | A unique identifier returned when a scan is initiated; required for subsequent data queries |

---

## Endpoints

### Health Check

#### `GET /`

Confirms the server is running.

**Response**

```json
{
  "message": "DirStudio API is running"
}
```

---

### Scanning

#### `POST /scan`

Initiates a directory scan. Walks the filesystem recursively, extracts file metadata, computes SHA-256 hashes, and stores results for later querying.

**Request Body**

```json
{
  "path": "/absolute/path/to/directory"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✅ | Absolute path to the directory to scan |

**Response**

```json
{
  "scan_id": "a1b2c3d4-...",
  "status": "completed",
  "file_count": 142,
  "total_size_bytes": 5823901
}
```

| Field | Type | Description |
|---|---|---|
| `scan_id` | string | Unique identifier for this scan session |
| `status` | string | `"completed"` or `"error"` |
| `file_count` | integer | Total number of files discovered |
| `total_size_bytes` | integer | Aggregate size of all scanned files in bytes |

**Error Responses**

| Status | Meaning |
|---|---|
| `400` | Path is invalid or not accessible |
| `500` | Internal server error during scanning |

---

### Overview & Analytics

#### `GET /overview/{scan_id}`

Returns high-level analytics for a completed scan.

**Path Parameters**

| Parameter | Type | Description |
|---|---|---|
| `scan_id` | string | The ID returned from `POST /scan` |

**Response**

```json
{
  "scan_id": "a1b2c3d4-...",
  "total_files": 142,
  "total_size_bytes": 5823901,
  "total_directories": 18,
  "file_type_distribution": {
    ".jpg": 45,
    ".pdf": 20,
    ".py": 31,
    ".txt": 12,
    "other": 34
  },
  "largest_files": [
    {
      "path": "/some/dir/video.mp4",
      "size_bytes": 1048576
    }
  ],
  "empty_directories": ["/some/dir/empty_folder"]
}
```

| Field | Type | Description |
|---|---|---|
| `total_files` | integer | Total file count |
| `total_size_bytes` | integer | Total size in bytes |
| `total_directories` | integer | Number of subdirectories found |
| `file_type_distribution` | object | Map of file extensions to counts |
| `largest_files` | array | Top files by size |
| `empty_directories` | array | Paths of directories with no files |

---

### Duplicates

#### `GET /duplicates/{scan_id}`

Returns groups of duplicate files identified by SHA-256 hash comparison.

**Path Parameters**

| Parameter | Type | Description |
|---|---|---|
| `scan_id` | string | The ID returned from `POST /scan` |

**Response**

```json
{
  "scan_id": "a1b2c3d4-...",
  "duplicate_groups": [
    {
      "hash": "e3b0c44298fc1c149afb...",
      "size_bytes": 204800,
      "count": 3,
      "files": [
        "/path/to/file_original.jpg",
        "/path/to/copy/file_original.jpg",
        "/backup/file_original.jpg"
      ]
    }
  ],
  "total_duplicate_groups": 5,
  "reclaimable_bytes": 1638400
}
```

| Field | Type | Description |
|---|---|---|
| `duplicate_groups` | array | Each group contains files sharing the same SHA-256 hash |
| `hash` | string | SHA-256 hash shared by all files in the group |
| `size_bytes` | integer | Size of one copy of the file |
| `count` | integer | Number of copies found |
| `files` | array | Absolute paths to each duplicate |
| `reclaimable_bytes` | integer | Storage that can be freed by removing duplicates |

---

### File Operations

#### `DELETE /files`

Deletes one or more files by path. This operation is permanent — use with caution.

**Request Body**

```json
{
  "paths": [
    "/path/to/duplicate_copy.jpg",
    "/path/to/another_duplicate.jpg"
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `paths` | array of strings | ✅ | Absolute paths to files that should be deleted |

**Response**

```json
{
  "deleted": [
    "/path/to/duplicate_copy.jpg",
    "/path/to/another_duplicate.jpg"
  ],
  "failed": [],
  "deleted_count": 2,
  "failed_count": 0
}
```

| Field | Type | Description |
|---|---|---|
| `deleted` | array | Paths successfully deleted |
| `failed` | array | Paths that could not be deleted |
| `deleted_count` | integer | Number of files deleted |
| `failed_count` | integer | Number of files that failed to delete |

**Error Responses**

| Status | Meaning |
|---|---|
| `400` | No paths provided |
| `403` | Permission denied on one or more paths |

---

### AI Organization

#### `POST /organize`

Sends directory scan data to the Mistral AI model (via LangChain) and returns intelligent folder restructuring suggestions.

> **Note:** Requires a valid `MISTRAL_API_KEY` set in `dirstudio/server/.env`. Only file names and metadata are sent — no file content is transmitted externally.

**Request Body**

```json
{
  "scan_id": "a1b2c3d4-..."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `scan_id` | string | ✅ | Scan to generate suggestions for |

**Response**

```json
{
  "scan_id": "a1b2c3d4-...",
  "suggestions": [
    {
      "action": "restructure",
      "description": "Group all image files under an /images/ subdirectory by year",
      "example": "photos/2023/img001.jpg"
    },
    {
      "action": "rename_policy",
      "description": "Standardize document names to lowercase with hyphens",
      "example": "project-report-2024.pdf"
    }
  ],
  "summary": "The scanned directory contains mixed media and documents without a clear hierarchy. Reorganizing by file type and date will improve discoverability."
}
```

| Field | Type | Description |
|---|---|---|
| `suggestions` | array | List of AI-generated organization suggestions |
| `action` | string | Type of suggestion (`restructure`, `rename_policy`, `group`) |
| `description` | string | Human-readable explanation |
| `example` | string | Example path or pattern |
| `summary` | string | High-level assessment of the directory |

**Error Responses**

| Status | Meaning |
|---|---|
| `400` | Invalid or unknown `scan_id` |
| `503` | Mistral API unavailable or key missing |

---

## Error Format

All errors follow this structure:

```json
{
  "detail": "Human-readable error message describing what went wrong."
}
```

---

## Authentication

The API does not currently implement authentication. It is intended for local use only. **Do not expose the backend port to an external network without adding authentication.**

---

## Example: End-to-End Flow

```bash
# 1. Start a scan
curl -X POST http://localhost:8000/scan \
  -H "Content-Type: application/json" \
  -d '{"path": "/home/user/Documents"}'

# Response: { "scan_id": "abc123", "status": "completed", "file_count": 87, ... }

# 2. Get an overview
curl http://localhost:8000/overview/abc123

# 3. Find duplicates
curl http://localhost:8000/duplicates/abc123

# 4. Delete selected duplicates
curl -X DELETE http://localhost:8000/files \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/home/user/Documents/copy/report.pdf"]}'

# 5. Get AI organization suggestions
curl -X POST http://localhost:8000/organize \
  -H "Content-Type: application/json" \
  -d '{"scan_id": "abc123"}'
```

---

## Rate Limiting & Performance Notes

- There are no artificial rate limits on local endpoints.
- The `/scan` endpoint performance scales with directory size. Very large directories (100k+ files) may take significant time.
- The `/organize` endpoint is subject to Mistral API rate limits and external latency.
- Results from a given `scan_id` persist for the lifetime of the server session. Restarting the server clears all cached scans.