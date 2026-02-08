/**
 * DirStudio Main Application
 * Application logic and event handlers
 */

(function() {
    'use strict';

    var ws = null;

    /**
     * Initialize application
     */
    function init() {
        // Apply saved / system theme
        Utils.setTheme(Utils.getPreferredTheme());

        var themeBtn = document.getElementById('themeToggleBtn');
        if (themeBtn) {
            themeBtn.addEventListener('click', Utils.toggleTheme);
        }

        console.log('DirStudio initialized');
        loadScans();
    }

    /**
     * Load all scans
     */
    function loadScans() {
        API.getAllScans()
            .then(function(data) {
                renderScanHistory(data.scans || []);
            })
            .catch(function(error) {
                console.error('Failed to load scans:', error);
            });
    }

    /**
     * Render scan history in sidebar
     * @param {Array} scans - List of scans
     */
    function renderScanHistory(scans) {
        var container = document.getElementById('scanHistoryList');
        if (!container) return;

        if (scans.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>No scans yet</p></div>';
            return;
        }

        var html = '';
        scans.forEach(function(scan) {
            html += '<div class="scan-card" onclick="loadScan(\'' + scan.scan_id + '\')">';
            html += '<div class="scan-name"><i class="fas fa-folder"></i>' + getPathName(scan.path) + '</div>';
            html += '<div class="scan-path">' + scan.path + '</div>';
            html += '<div class="scan-meta">';
            html += '<span>' + Utils.formatNumber(scan.file_count) + ' files</span>';
            html += '<span>' + Utils.formatBytes(scan.total_size) + '</span>';
            html += '</div></div>';
        });

        container.innerHTML = html;
    }

    /**
     * Get folder name from path
     * @param {string} path - Full path
     * @returns {string} Folder name
     */
    function getPathName(path) {
        if (!path) return 'Unknown';
        var parts = path.split('/');
        return parts[parts.length - 1] || parts[parts.length - 2] || 'Root';
    }

    /**
     * Load scan data and display
     * @param {string} scanId - Scan ID
     */
    function loadScan(scanId) {
        API.setCurrentScan(scanId);
        
        // Mark active scan card
        var cards = document.querySelectorAll('.scan-card');
        cards.forEach(function(card) {
            card.classList.remove('active');
        });
        event.currentTarget.classList.add('active');

        // Load scan details
        API.getScan(scanId)
            .then(function(scan) {
                updateOverview(scan);
            })
            .catch(function(error) {
                console.error('Failed to load scan:', error);
            });

        // Load analysis
        loadAnalysis(scanId);
        
        // Load duplicates
        loadDuplicates(scanId);
        
        // Load tree
        loadTree(scanId);
    }

    /**
     * Update overview tab
     * @param {object} scan - Scan data
     */
    function updateOverview(scan) {
        document.getElementById('totalFiles').textContent = Utils.formatNumber(scan.file_count);
        document.getElementById('totalSize').textContent = Utils.formatBytes(scan.total_size);
        document.getElementById('totalDirs').textContent = Utils.formatNumber(scan.directory_count);
    }

    /**
     * Load analysis data
     * @param {string} scanId - Scan ID
     */
    function loadAnalysis(scanId) {
        API.getAnalysis(scanId)
            .then(function(data) {
                renderFileTypes(data.file_types || []);
                renderLargestFiles(data.largest_files || []);
            })
            .catch(function(error) {
                console.error('Failed to load analysis:', error);
            });
    }

    /**
     * Render file type distribution
     * @param {Array} fileTypes - File type data
     */
    function renderFileTypes(fileTypes) {
        var container = document.getElementById('fileTypeChart');
        if (!container) return;

        if (fileTypes.length === 0) {
            container.innerHTML = '<div class="empty-state">No data</div>';
            return;
        }

        var html = '';
        fileTypes.forEach(function(type) {
            var percentage = type.percentage || 0;
            html += '<div class="list-item">';
            html += '<span>' + (type.extension || 'unknown') + ' (' + type.count + ')</span>';
            html += '<span>' + Utils.formatBytes(type.size) + '</span>';
            html += '</div>';
        });

        container.innerHTML = html;
    }

    /**
     * Render largest files
     * @param {Array} files - File list
     */
    function renderLargestFiles(files) {
        var container = document.getElementById('largestFilesList');
        if (!container) return;

        if (files.length === 0) {
            container.innerHTML = '<div class="empty-state">No files</div>';
            return;
        }

        var html = '';
        files.forEach(function(file) {
            html += '<div class="list-item">';
            html += '<span>' + Utils.truncate(file.path, 30) + '</span>';
            html += '<span>' + Utils.formatBytes(file.size) + '</span>';
            html += '</div>';
        });

        container.innerHTML = html;
    }

    /**
     * Load duplicates
     * @param {string} scanId - Scan ID
     */
    function loadDuplicates(scanId) {
        API.getDuplicates(scanId)
            .then(function(data) {
                renderDuplicates(data.groups || []);
            })
            .catch(function(error) {
                console.error('Failed to load duplicates:', error);
            });
    }

    /**
     * Render duplicate groups
     * @param {Array} groups - Duplicate groups
     */
    function renderDuplicates(groups) {
        var container = document.getElementById('duplicateGroups');
        if (!container) return;

        if (groups.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><p>No duplicates found</p></div>';
            return;
        }

        var html = '';
        groups.forEach(function(group) {
            html += '<div class="duplicate-group">';
            html += '<div class="duplicate-header">';
            html += '<strong>' + group.file_count + ' duplicates</strong>';
            html += '<span>Wasted: ' + Utils.formatBytes(group.wasted_space) + '</span>';
            html += '</div>';
            html += '<div class="duplicate-files">';
            
            group.files.forEach(function(file) {
                html += '<div class="duplicate-file">';
                html += '<i class="fas ' + Utils.getFileIcon(file.extension) + '"></i> ';
                html += file.path;
                html += '</div>';
            });
            
            html += '</div></div>';
        });

        container.innerHTML = html;
    }

    /**
     * Load directory tree
     * @param {string} scanId - Scan ID
     */
    function loadTree(scanId) {
        API.getTree(scanId)
            .then(function(data) {
                renderTree(data.tree);
            })
            .catch(function(error) {
                console.error('Failed to load tree:', error);
            });
    }

    /**
     * Render directory tree
     * @param {object} tree - Tree data
     */
    function renderTree(tree) {
        var container = document.getElementById('directoryTree');
        if (!container) return;

        container.innerHTML = buildTreeHTML(tree);
    }

    /**
     * Build tree HTML recursively
     * @param {object} node - Tree node
     * @returns {string} HTML string
     */
    function buildTreeHTML(node) {
        if (!node) return '';

        var html = '<div class="tree-node">';
        html += '<div class="tree-node-content">';
        html += '<i class="fas fa-folder"></i> ';
        html += '<strong>' + node.name + '</strong> ';
        html += '<span class="text-muted">(' + Utils.formatBytes(node.size) + ')</span>';
        html += '</div>';

        if (node.children && node.children.length > 0) {
            html += '<div class="tree-children">';
            node.children.forEach(function(child) {
                html += buildTreeHTML(child);
            });
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    /**
     * Select directory (called from sidebar)
     */
    window.selectDirectory = function() {
        var path = prompt('Enter directory path to scan:');
        if (!path || !Utils.isValidPath(path)) {
            Utils.showToast('Invalid path', 'error');
            return;
        }

        API.createScan(path)
            .then(function(scan) {
                Utils.showToast('Scan created successfully', 'success');
                
                // Connect WebSocket for progress
                ws = API.connectWebSocket(scan.scan_id, handleScanProgress);
                
                // Reload scan list
                loadScans();
            })
            .catch(function(error) {
                Utils.showToast('Failed to create scan: ' + error.message, 'error');
            });
    };

    /**
     * Handle scan progress updates
     * @param {object} data - Progress data
     */
    function handleScanProgress(data) {
        console.log('Scan progress:', data);
        
        if (data.type === 'complete') {
            Utils.showToast('Scan completed', 'success');
            loadScans();
            if (ws) {
                ws.close();
            }
        }
    }

    /**
     * Clean duplicates (called from UI)
     */
    window.cleanDuplicates = function() {
        var scanId = API.getCurrentScan();
        if (!scanId) {
            Utils.showToast('No scan selected', 'error');
            return;
        }

        if (!confirm('Are you sure you want to clean duplicates?')) {
            return;
        }

        API.cleanDuplicates(scanId, { groups: [], dry_run: false })
            .then(function(result) {
                Utils.showToast('Cleaned ' + result.deleted_count + ' files', 'success');
                loadDuplicates(scanId);
            })
            .catch(function(error) {
                Utils.showToast('Failed to clean duplicates: ' + error.message, 'error');
            });
    };

    // Initialize when components are loaded
    window.onComponentsLoaded = init;
})();