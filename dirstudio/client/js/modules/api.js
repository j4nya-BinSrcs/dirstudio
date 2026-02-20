/**
 * DirStudio API Client
 * All backend communication goes through /api/*
 */

var API = (function () {
    'use strict';

    // ============================================================
    // CONFIG
    // ============================================================

    const BASE_URL = 'http://localhost:8000';
    const API_PREFIX = '/api';

    let currentScanId = null;

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    /**
     * Build full API URL
     */
    function apiUrl(path) {
        if (!path.startsWith('/')) path = '/' + path;
        return BASE_URL + API_PREFIX + path;
    }

    /**
     * Unified fetch wrapper
     */
    async function request(path, options = {}) {
        const fetchOptions = {
            credentials: 'same-origin',
            ...options,
            headers: {
                ...(options.headers || {})
            }
        };

        if (fetchOptions.body && typeof fetchOptions.body === 'string') {
            fetchOptions.headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(apiUrl(path), fetchOptions);

        if (!response.ok) {
            let errorText;
            try {
                errorText = await response.text();
            } catch {
                errorText = response.statusText;
            }
            throw new Error(errorText || `API error (${response.status})`);
        }

        // 204 No Content safety
        if (response.status === 204) {
            return null;
        }

        return response.json();
    }

    // ============================================================
    // SCANS
    // ============================================================

    function createScan(path, options = {}) {
        return request('/scans', {
            method: 'POST',
            body: JSON.stringify({
                path: path,
                max_depth: options.max_depth ?? null,
                compute_sha256: options.compute_sha256 !== false,
                compute_phash: options.compute_phash !== false,
                num_workers: options.num_workers ?? null
            })
        });
    }

    function getAllScans(skip = 0, limit = 100) {
        return request(`/scans?skip=${skip}&limit=${limit}`);
    }

    function getScan(scanId) {
        return request(`/scans/${scanId}`);
    }

    function getScanOverview(scanId) {
        return request(`/scans/${scanId}/overview`);
    }

    function getTree(scanId) {
        return request(`/scans/${scanId}/tree`).then(response => {
            return response.root || response.tree || response.data || response;
        });
    }

    function deleteScan(scanId) {
        return request(`/scans/${scanId}`, { method: 'DELETE' });
    }

    // ============================================================
    // DUPLICATES
    // ============================================================

    function getDuplicates(scanId, options = {}) {
        const params = new URLSearchParams();

        if (options.detect_exact !== undefined)
            params.set('detect_exact', options.detect_exact);
        if (options.detect_near !== undefined)
            params.set('detect_near', options.detect_near);
        if (options.phash_threshold !== undefined)
            params.set('phash_threshold', options.phash_threshold);

        const query = params.toString();
        return request(`/scans/${scanId}/duplicates${query ? '?' + query : ''}`);
    }

    // ============================================================
    // ORGANIZE
    // ============================================================

    function getOrganizeSuggestions(scanId, options = {}) {
        const params = new URLSearchParams();

        if (options.base_path)
            params.set('base_path', options.base_path);
        if (options.temperature)
            params.set('temperature', options.temperature);

        const query = params.toString();
        return request(`/scans/${scanId}/organize${query ? '?' + query : ''}`);
    }

    // ============================================================
    // TRANSFORMS
    // ============================================================

    function transformFiles(scanId, data) {
        return request(`/scans/${scanId}/transform`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    function compressFiles(scanId, filePaths, targetPath, format = 'zip', dryRun = false) {
        return transformFiles(scanId, {
            operation: 'compress',
            file_paths: filePaths,
            target_path: targetPath,
            params: { format },
            dry_run: dryRun
        });
    }

    function convertImages(scanId, filePaths, format, outputDir, dryRun = false) {
        return transformFiles(scanId, {
            operation: 'convert',
            file_paths: filePaths,
            target_path: outputDir,
            params: { format },
            dry_run: dryRun
        });
    }

    function resizeImages(scanId, filePaths, maxWidth = 1920, maxHeight = 1080, outputDir, dryRun = false) {
        return transformFiles(scanId, {
            operation: 'resize',
            file_paths: filePaths,
            target_path: outputDir,
            params: { max_width: maxWidth, max_height: maxHeight },
            dry_run: dryRun
        });
    }

    function moveFiles(scanId, filePaths, targetPath, dryRun = false) {
        return transformFiles(scanId, {
            operation: 'move',
            file_paths: filePaths,
            target_path: targetPath,
            dry_run: dryRun
        });
    }

    function copyFiles(scanId, filePaths, targetPath, dryRun = false) {
        return transformFiles(scanId, {
            operation: 'copy',
            file_paths: filePaths,
            target_path: targetPath,
            dry_run: dryRun
        });
    }

    function deleteFiles(scanId, filePaths, dryRun = false) {
        return transformFiles(scanId, {
            operation: 'delete',
            file_paths: filePaths,
            dry_run: dryRun
        });
    }

    // ============================================================
    // STATS
    // ============================================================

    function getGlobalStats() {
        return request('/stats');
    }

    // ============================================================
    // WEBSOCKET
    // ============================================================

    function connectWebSocket(scanId, onMessage) {
        const wsUrl =
            BASE_URL.replace(/^http/, 'ws') +
            API_PREFIX +
            `/ws/scan/${scanId}`;

        const ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
            try {
                onMessage?.(JSON.parse(event.data));
            } catch (e) {
                console.error('WebSocket parse error', e);
            }
        };

        return ws;
    }

    // ============================================================
    // STATE
    // ============================================================

    function setCurrentScan(scanId) {
        currentScanId = scanId;
        localStorage.setItem('currentScanId', scanId);
    }

    function getCurrentScan() {
        if (!currentScanId) {
            currentScanId = localStorage.getItem('currentScanId');
        }
        return currentScanId;
    }

    function clearCurrentScan() {
        currentScanId = null;
        localStorage.removeItem('currentScanId');
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    return {
        createScan,
        getAllScans,
        getScan,
        getScanOverview,
        getTree,
        deleteScan,

        getDuplicates,
        getOrganizeSuggestions,

        transformFiles,
        compressFiles,
        convertImages,
        resizeImages,
        moveFiles,
        copyFiles,
        deleteFiles,

        getGlobalStats,
        connectWebSocket,

        setCurrentScan,
        getCurrentScan,
        clearCurrentScan
    };
})();