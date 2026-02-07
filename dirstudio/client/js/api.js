/**
 * DirStudio API Client
 * Handles all communication with backend server
 */

var API = (function() {
    'use strict';

    var BASE_URL = 'http://localhost:8000';
    var currentScanId = null;

    /**
     * Make HTTP request
     * @param {string} endpoint - API endpoint
     * @param {object} options - Fetch options
     * @returns {Promise} Response data
     */
    function request(endpoint, options) {
        options = options || {};
        options.headers = options.headers || {};
        options.headers['Content-Type'] = 'application/json';

        return fetch(BASE_URL + endpoint, options)
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('API request failed: ' + response.statusText);
                }
                return response.json();
            })
            .catch(function(error) {
                console.error('API Error:', error);
                throw error;
            });
    }

    /**
     * Create a new scan
     * @param {string} path - Directory path
     * @returns {Promise} Scan data
     */
    function createScan(path) {
        return request('/scans', {
            method: 'POST',
            body: JSON.stringify({ path: path })
        });
    }

    /**
     * Get all scans
     * @returns {Promise} List of scans
     */
    function getAllScans() {
        return request('/scans');
    }

    /**
     * Get scan details
     * @param {string} scanId - Scan ID
     * @returns {Promise} Scan details
     */
    function getScan(scanId) {
        return request('/scans/' + scanId);
    }

    /**
     * Delete a scan
     * @param {string} scanId - Scan ID
     * @returns {Promise} Delete result
     */
    function deleteScan(scanId) {
        return request('/scans/' + scanId, {
            method: 'DELETE'
        });
    }

    /**
     * Get scan analysis/overview
     * @param {string} scanId - Scan ID
     * @returns {Promise} Analysis data
     */
    function getAnalysis(scanId) {
        return request('/scans/' + scanId + '/analysis');
    }

    /**
     * Get directory tree
     * @param {string} scanId - Scan ID
     * @returns {Promise} Tree data
     */
    function getTree(scanId) {
        return request('/scans/' + scanId + '/tree');
    }

    /**
     * Get duplicate files
     * @param {string} scanId - Scan ID
     * @returns {Promise} Duplicate groups
     */
    function getDuplicates(scanId) {
        return request('/scans/' + scanId + '/duplicates');
    }

    /**
     * Clean duplicate files
     * @param {string} scanId - Scan ID
     * @param {object} data - Cleanup data
     * @returns {Promise} Cleanup result
     */
    function cleanDuplicates(scanId, data) {
        return request('/scans/' + scanId + '/duplicates/clean', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    /**
     * Connect to WebSocket for real-time updates
     * @param {string} scanId - Scan ID
     * @param {function} onMessage - Message handler
     * @returns {WebSocket} WebSocket instance
     */
    function connectWebSocket(scanId, onMessage) {
        var wsUrl = BASE_URL.replace('http', 'ws') + '/ws/scan/' + scanId;
        var ws = new WebSocket(wsUrl);

        ws.onopen = function() {
            console.log('WebSocket connected');
        };

        ws.onmessage = function(event) {
            var data = JSON.parse(event.data);
            if (onMessage) {
                onMessage(data);
            }
        };

        ws.onerror = function(error) {
            console.error('WebSocket error:', error);
        };

        ws.onclose = function() {
            console.log('WebSocket closed');
        };

        return ws;
    }

    /**
     * Set current scan ID
     * @param {string} scanId - Scan ID
     */
    function setCurrentScan(scanId) {
        currentScanId = scanId;
    }

    /**
     * Get current scan ID
     * @returns {string} Current scan ID
     */
    function getCurrentScan() {
        return currentScanId;
    }

    // Public API
    return {
        createScan: createScan,
        getAllScans: getAllScans,
        getScan: getScan,
        deleteScan: deleteScan,
        getAnalysis: getAnalysis,
        getTree: getTree,
        getDuplicates: getDuplicates,
        cleanDuplicates: cleanDuplicates,
        connectWebSocket: connectWebSocket,
        setCurrentScan: setCurrentScan,
        getCurrentScan: getCurrentScan
    };
})();