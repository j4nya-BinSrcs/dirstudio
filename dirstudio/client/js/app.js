/**
 * DirStudio Main Application - Enhanced Version with Transform
 * Application logic and event handlers
 */

(function() {
    'use strict';

    var ws = null;
    var scanStatusInterval = null;
    var selectedFiles = []; // Track selected files from tree

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
        loadGlobalStats();
        
        // Check for current scan in storage
        var currentScan = API.getCurrentScan();
        if (currentScan) {
            loadScan(currentScan);
        }
    }

    /**
     * Load global statistics
     */
    function loadGlobalStats() {
        API.getGlobalStats()
            .then(function(stats) {
                console.log('Global stats:', stats);
            })
            .catch(function(error) {
                console.error('Failed to load global stats:', error);
            });
    }

    /**
     * Load all scans
     */
    function loadScans() {
        API.getAllScans()
            .then(function(scans) {
                // Sort scans by created_at descending (newest first)
                scans.sort(function(a, b) {
                    var dateA = new Date(a.created_at || 0);
                    var dateB = new Date(b.created_at || 0);
                    return dateB - dateA;
                });
                renderScanHistory(scans || []);
            })
            .catch(function(error) {
                console.error('Failed to load scans:', error);
                Utils.showToast('Failed to load scans: ' + error.message, 'error');
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
            var statusClass = scan.status === 'completed' ? 'success' : 
                            scan.status === 'running' ? 'info' : 
                            scan.status === 'failed' ? 'danger' : 'secondary';
            
            html += '<div class="scan-card" onclick="loadScanFromCard(event, \'' + scan.scan_id + '\')" data-scan-id="' + scan.scan_id + '">';
            html += '<div class="scan-name"><i class="fas fa-folder"></i>' + getPathName(scan.path) + '</div>';
            html += '<div class="scan-path" title="' + scan.path + '">' + scan.path + '</div>';
            html += '<div class="scan-meta">';
            html += '<span class="badge bg-' + statusClass + '">' + scan.status + '</span>';
            if (scan.error) {
                html += '<span class="text-danger ms-2" title="' + scan.error + '"><i class="fas fa-exclamation-triangle"></i></span>';
            }
            html += '</div></div>';
        });

        container.innerHTML = html;
    }

    /**
     * Load scan from card click (exposed globally)
     */
    window.loadScanFromCard = function(event, scanId) {
        event.stopPropagation();
        loadScan(scanId);
    };

    /**
     * Get folder name from path
     * @param {string} path - Full path
     * @returns {string} Folder name
     */
    function getPathName(path) {
        if (!path) return 'Unknown';
        var parts = path.replace(/\\/g, '/').split('/');
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
            if (card.getAttribute('data-scan-id') === scanId) {
                card.classList.add('active');
            }
        });

        // Clear any existing polling
        if (scanStatusInterval) {
            clearInterval(scanStatusInterval);
            scanStatusInterval = null;
        }

        // Load scan status
        API.getScan(scanId)
            .then(function(scan) {
                console.log('Scan status:', scan);
                
                if (scan.status === 'running' || scan.status === 'pending') {
                    // Start polling for status updates
                    pollScanStatus(scanId);
                    Utils.showToast('Scan is ' + scan.status + '...', 'info');
                } else if (scan.status === 'completed') {
                    // Load all data
                    loadScanData(scanId);
                } else if (scan.status === 'failed') {
                    Utils.showToast('Scan failed: ' + (scan.error || 'Unknown error'), 'error');
                }
            })
            .catch(function(error) {
                console.error('Failed to load scan:', error);
                Utils.showToast('Failed to load scan: ' + error.message, 'error');
            });
    }

    /**
     * Poll scan status until complete
     * @param {string} scanId - Scan ID
     */
    function pollScanStatus(scanId) {
        scanStatusInterval = setInterval(function() {
            API.getScan(scanId)
                .then(function(scan) {
                    if (scan.status === 'completed') {
                        clearInterval(scanStatusInterval);
                        scanStatusInterval = null;
                        Utils.showToast('Scan completed!', 'success');
                        loadScanData(scanId);
                        loadScans(); // Refresh scan list
                    } else if (scan.status === 'failed') {
                        clearInterval(scanStatusInterval);
                        scanStatusInterval = null;
                        Utils.showToast('Scan failed: ' + (scan.error || 'Unknown error'), 'error');
                    }
                })
                .catch(function(error) {
                    console.error('Polling error:', error);
                });
        }, 2000); // Poll every 2 seconds
    }

    /**
     * Load all scan data (overview, tree, duplicates)
     * @param {string} scanId - Scan ID
     */
    function loadScanData(scanId) {
        loadOverview(scanId);
        loadTree(scanId);
        loadDuplicates(scanId);
    }

    /**
     * Load overview/statistics
     * @param {string} scanId - Scan ID
     */
    function loadOverview(scanId) {
        API.getScanOverview(scanId)
            .then(function(data) {
                updateOverview(data);
                renderFileTypes(data.top_extensions || []);
            })
            .catch(function(error) {
                console.error('Failed to load overview:', error);
                Utils.showToast('Failed to load overview: ' + error.message, 'error');
            });
    }

    /**
     * Update overview tab
     * @param {object} data - Overview data
     */
    function updateOverview(data) {
        document.getElementById('totalFiles').textContent = Utils.formatNumber(data.total_files || 0);
        document.getElementById('totalSize').textContent = Utils.formatBytes(data.total_size || 0);
        document.getElementById('totalDirs').textContent = Utils.formatNumber(data.total_dirs || 0);
    }

    /**
     * Render file type distribution
     * @param {Array} extensions - Extension data
     */
    function renderFileTypes(extensions) {
        var container = document.getElementById('fileTypeChart');
        if (!container) return;

        if (extensions.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No data</p></div>';
            return;
        }

        var html = '';
        extensions.forEach(function(ext) {
            html += '<div class="list-item">';
            html += '<span><i class="fas ' + Utils.getFileIcon(ext.ext) + '"></i> ' + 
                    (ext.ext || 'unknown') + '</span>';
            html += '<span>' + Utils.formatNumber(ext.count) + ' files</span>';
            html += '</div>';
        });

        container.innerHTML = html;
        
        // Also update extensions list
        var extList = document.getElementById('extensionsList');
        if (extList) {
            extList.innerHTML = html;
        }
    }

    /**
     * Load duplicates
     * @param {string} scanId - Scan ID
     */
    function loadDuplicates(scanId) {
        API.getDuplicates(scanId, {
            detect_exact: true,
            detect_near: true
        })
            .then(function(data) {
                renderDuplicates(data);
            })
            .catch(function(error) {
                console.error('Failed to load duplicates:', error);
                Utils.showToast('Failed to load duplicates: ' + error.message, 'error');
            });
    }

    /**
     * Render duplicate groups
     * @param {object} data - Duplicate data
     */
    function renderDuplicates(data) {
        var container = document.getElementById('duplicateGroups');
        if (!container) return;

        var exactGroups = data.exact_duplicates || {};
        var nearGroups = data.near_duplicates || {};
        var allGroups = Object.values(exactGroups).concat(Object.values(nearGroups));

        if (allGroups.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><p>No duplicates found</p></div>';
            return;
        }

        var html = '';
        allGroups.forEach(function(group) {
            var files = group.files || [];
            var typeClass = group.duplicate_type === 'exact' ? 'danger' : 'warning';
            
            html += '<div class="duplicate-group border-' + typeClass + '">';
            html += '<div class="duplicate-header">';
            html += '<strong><span class="badge bg-' + typeClass + '">' + group.duplicate_type + '</span> ';
            html += files.length + ' duplicates</strong>';
            html += '<span>Wastage: ' + Utils.formatBytes(group.wastage || 0) + '</span>';
            html += '</div>';
            html += '<div class="duplicate-files">';
            
            files.forEach(function(file) {
                var filePath = file.path || file;
                var ext = Utils.getExtension(filePath);
                html += '<div class="duplicate-file">';
                html += '<input type="checkbox" class="form-check-input" data-file-path="' + filePath + '">';
                html += '<i class="fas ' + Utils.getFileIcon(ext) + '"></i> ';
                html += '<span>' + filePath + '</span>';
                html += '</div>';
            });
            
            html += '</div></div>';
        });

        container.innerHTML = html;
        
        // Update statistics if available
        if (data.statistics) {
            var stats = data.statistics;
            var analysisContainer = document.getElementById('analysisStats');
            if (analysisContainer) {
                var statsHtml = '<div class="row g-3">';
                statsHtml += '<div class="col-md-6"><div class="stat-card">';
                statsHtml += '<div class="stat-icon"><i class="fas fa-copy"></i></div>';
                statsHtml += '<div class="stat-content">';
                statsHtml += '<div class="stat-label">Exact Duplicates</div>';
                statsHtml += '<div class="stat-value">' + (stats.exact_duplicate_groups || 0) + '</div>';
                statsHtml += '</div></div></div>';
                statsHtml += '<div class="col-md-6"><div class="stat-card">';
                statsHtml += '<div class="stat-icon"><i class="fas fa-clone"></i></div>';
                statsHtml += '<div class="stat-content">';
                statsHtml += '<div class="stat-label">Near Duplicates</div>';
                statsHtml += '<div class="stat-value">' + (stats.near_duplicate_groups || 0) + '</div>';
                statsHtml += '</div></div></div>';
                statsHtml += '<div class="col-md-6"><div class="stat-card">';
                statsHtml += '<div class="stat-icon"><i class="fas fa-trash"></i></div>';
                statsHtml += '<div class="stat-content">';
                statsHtml += '<div class="stat-label">Wasted Space</div>';
                statsHtml += '<div class="stat-value" style="font-size:20px;">' + Utils.formatBytes(stats.total_wastage || 0) + '</div>';
                statsHtml += '</div></div></div>';
                statsHtml += '<div class="col-md-6"><div class="stat-card">';
                statsHtml += '<div class="stat-icon"><i class="fas fa-file-alt"></i></div>';
                statsHtml += '<div class="stat-content">';
                statsHtml += '<div class="stat-label">Files Scanned</div>';
                statsHtml += '<div class="stat-value" style="font-size:20px;">' + Utils.formatNumber(stats.total_files_scanned || 0) + '</div>';
                statsHtml += '</div></div></div>';
                statsHtml += '</div>';
                analysisContainer.innerHTML = statsHtml;
            }
        }
    }

    /**
     * Load directory tree
     * @param {string} scanId - Scan ID
     */
    function loadTree(scanId) {
        API.getTree(scanId)
            .then(function (response) {
                console.log('RAW TREE RESPONSE:', response);

                // ✅ Accept both wrapped and direct responses
                const rootNode = response.root ? response.root : response;

                if (!rootNode || !rootNode.path) {
                    throw new Error('Invalid tree response');
                }

                const treeRoot = normalizeFsNode(rootNode);
                console.log('NORMALIZED TREE ROOT:', treeRoot);

                renderTree(treeRoot);
            })
            .catch(function (error) {
                console.error('Error loading tree:', error);

                const el = document.getElementById('directoryTree');
                if (el) {
                    el.innerHTML =
                        '<div class="alert alert-danger">Failed to load directory tree</div>';
                }
            });
    }

    function normalizeFsNode(node) {
        if (!node || !node.path) return null;

        const name = node.path.split(/[\\/]/).pop();

        // Directory
        if (node.subdirs || node.files) {
            const children = [];

            if (Array.isArray(node.subdirs)) {
                node.subdirs.forEach(subdir => {
                    const child = normalizeFsNode(subdir);
                    if (child) children.push(child);
                });
            }

            if (Array.isArray(node.files)) {
                node.files.forEach(file => {
                    children.push({
                        type: 'file',
                        name: file.path.split(/[\\/]/).pop(),
                        path: file.path,
                        size: file.metadata?.size || 0,
                        metadata: file.metadata,
                        hashes: file.hashes || {}
                    });
                });
            }

            return {
                type: 'directory',
                name,
                path: node.path,
                size: node.metadata?.size || 0,
                children
            };
        }

        return null;
    }


    /**
     * Render directory tree with VSCode-like styling and file selection
     * @param {object} tree - Tree data
     */
    function renderTree(tree) {
        const container = document.getElementById('directoryTree');
        if (!container) {
            console.error('directoryTree container not found');
            return;
        }

        container.innerHTML = buildTreeHTML(tree, 0, true);
        attachTreeHandlers(container);
    }

    /**
     * Build tree HTML recursively with VSCode-like styling and checkboxes
     * @param {object} node - Tree node
     * @param {number} depth - Current depth
     * @param {boolean} isRoot - Is root node
     * @returns {string} HTML string
     */
    function buildTreeHTML(node, depth = 0, isRoot = false) {
        if (!node) return '';

        const nodeId = Math.random().toString(36).slice(2);
        const hasChildren = Array.isArray(node.children) && node.children.length > 0;
        const isExpanded = isRoot === true;

        let html = '<div class="tree-node" data-node-id="' + nodeId + '">';

        html += '<div class="tree-node-content" style="padding-left:' + (depth * 16) + 'px">';

        // Toggle icon
        if (hasChildren) {
            html +=
                '<i class="fas ' +
                (isExpanded ? 'fa-chevron-down expanded' : 'fa-chevron-right') +
                ' tree-toggle" data-node-id="' + nodeId + '"></i>';
        } else {
            html += '<span class="tree-spacer"></span>';
        }

        // File / folder icon
        if (node.type === 'file') {
            html += `
                <input
                    type="checkbox"
                    class="tree-checkbox me-2"
                    data-file-path="${node.path}"
                    onchange="handleFileSelection(this)"
                >
                <i class="fas fa-file tree-icon file-icon"></i>
            `;
        } else {
            html += '<i class="fas fa-folder tree-icon folder-icon"></i>';
        }

        html += '<span class="tree-label">' + node.name + '</span>';
        html += '</div>';

        // Children
        if (hasChildren) {
            html +=
                '<div class="tree-children" data-parent="' + nodeId + '"' +
                (isExpanded ? '' : ' style="display:none"') +
                '>';

            node.children.forEach(child => {
                html += buildTreeHTML(child, depth + 1, false);
            });

            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function attachTreeHandlers(container) {
        container.querySelectorAll('.tree-toggle').forEach(toggle => {
            toggle.addEventListener('click', function (e) {
                e.stopPropagation();

                const nodeId = this.dataset.nodeId;
                const children = container.querySelector(
                    '.tree-children[data-parent="' + nodeId + '"]'
                );

                if (!children) return;

                const expanded = this.classList.contains('expanded');

                if (expanded) {
                    children.style.display = 'none';
                    this.classList.remove('expanded');
                    this.classList.replace('fa-chevron-down', 'fa-chevron-right');
                } else {
                    children.style.display = 'block';
                    this.classList.add('expanded');
                    this.classList.replace('fa-chevron-right', 'fa-chevron-down');
                }
            });
        });
    }


    /**
     * Handle file selection from tree
     */
    window.handleFileSelection = function(checkbox) {
        var filePath = checkbox.getAttribute('data-file-path');
        
        if (checkbox.checked) {
            if (selectedFiles.indexOf(filePath) === -1) {
                selectedFiles.push(filePath);
            }
        } else {
            var index = selectedFiles.indexOf(filePath);
            if (index > -1) {
                selectedFiles.splice(index, 1);
            }
        }
        
        updateSelectedCount();
    };

    /**
     * Update selected file count
     */
    function updateSelectedCount() {
        var countEl = document.getElementById('selectedFilesCount');
        if (countEl) {
            countEl.textContent = selectedFiles.length + ' selected';
        }
    }

    /**
     * Clear file selection
     */
    window.clearSelection = function() {
        selectedFiles = [];
        var checkboxes = document.querySelectorAll('.tree-checkbox');
        checkboxes.forEach(function(cb) {
            cb.checked = false;
        });
        updateSelectedCount();
    };

    /**
     * Attach event handlers to tree nodes
     */
    function attachTreeHandlers() {
        var toggles = document.querySelectorAll('.tree-toggle');
        toggles.forEach(function(toggle) {
            toggle.addEventListener('click', function(e) {
                e.stopPropagation();
                var nodeId = this.getAttribute('data-node-id');
                var children = document.querySelector('.tree-children[data-parent="' + nodeId + '"]');
                
                if (children) {
                    if (children.style.display === 'none') {
                        children.style.display = 'block';
                        this.classList.remove('fa-chevron-right');
                        this.classList.add('fa-chevron-down');
                        this.classList.add('expanded');
                        
                        // Change folder icon
                        var folderIcon = this.parentElement.querySelector('.fa-folder');
                        if (folderIcon) {
                            folderIcon.classList.remove('fa-folder');
                            folderIcon.classList.add('fa-folder-open');
                        }
                    } else {
                        children.style.display = 'none';
                        this.classList.remove('fa-chevron-down');
                        this.classList.add('fa-chevron-right');
                        this.classList.remove('expanded');
                        
                        // Change folder icon back
                        var folderIcon = this.parentElement.querySelector('.fa-folder-open');
                        if (folderIcon) {
                            folderIcon.classList.remove('fa-folder-open');
                            folderIcon.classList.add('fa-folder');
                        }
                    }
                }
            });
        });
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

        Utils.showToast('Starting scan...', 'info');

        API.createScan(path)
            .then(function(response) {
                Utils.showToast('Scan created: ' + response.scan_id, 'success');
                
                // Reload scan list (will now show at top)
                loadScans();
                
                // Load the new scan
                setTimeout(function() {
                    loadScan(response.scan_id);
                }, 1000);
            })
            .catch(function(error) {
                Utils.showToast('Failed to create scan: ' + error.message, 'error');
            });
    };

    /**
     * Select all duplicates
     */
    window.selectAllDuplicates = function() {
        var checkboxes = document.querySelectorAll('#duplicateGroups input[type="checkbox"]');
        checkboxes.forEach(function(cb) {
            cb.checked = true;
        });
    };

    /**
     * Clean duplicates (called from UI)
     */
    window.cleanDuplicates = function() {
        var scanId = API.getCurrentScan();
        if (!scanId) {
            Utils.showToast('No scan selected', 'error');
            return;
        }

        // Get selected files
        var checkboxes = document.querySelectorAll('#duplicateGroups input[type="checkbox"]:checked');
        var filePaths = Array.from(checkboxes).map(function(cb) {
            return cb.getAttribute('data-file-path');
        });

        if (filePaths.length === 0) {
            Utils.showToast('No files selected', 'error');
            return;
        }

        if (!confirm('Are you sure you want to delete ' + filePaths.length + ' files?')) {
            return;
        }

        API.deleteFiles(scanId, filePaths, false)
            .then(function(result) {
                var results = result.results || [];
                var successCount = results.filter(function(r) { return r.success; }).length;
                Utils.showToast('Deleted ' + successCount + ' of ' + filePaths.length + ' files', 'success');
                loadDuplicates(scanId);
            })
            .catch(function(error) {
                Utils.showToast('Failed to delete files: ' + error.message, 'error');
            });
    };

    /**
     * Generate AI suggestions
     */
    window.generateAISuggestions = function() {
        var scanId = API.getCurrentScan();
        if (!scanId) {
            Utils.showToast('No scan selected', 'error');
            return;
        }

        var container = document.getElementById('aiSuggestionsContent');
        container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Generating AI suggestions...</p></div>';

        API.getOrganizeSuggestions(scanId)
            .then(function(report) {
                var html = '<div class="alert alert-success">';
                html += '<h5><i class="fas fa-check-circle me-2"></i>AI Analysis Complete</h5>';
                html += '<pre>' + JSON.stringify(report, null, 2) + '</pre>';
                html += '</div>';
                container.innerHTML = html;
            })
            .catch(function(error) {
                container.innerHTML = '<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-2"></i>' + error.message + '</div>';
            });
    };

    // ============================================================================
    // TRANSFORM OPERATIONS
    // ============================================================================

    /**
     * Open compress modal
     */
    window.openCompressModal = function() {
        if (selectedFiles.length === 0) {
            Utils.showToast('Please select files from the tree first', 'error');
            return;
        }

        document.getElementById('compressFileCount').textContent = selectedFiles.length;
        var modal = new bootstrap.Modal(document.getElementById('compressModal'));
        modal.show();
    };

    /**
     * Execute compress operation
     */
    window.executeCompress = function() {
        var scanId = API.getCurrentScan();
        if (!scanId) {
            Utils.showToast('No scan selected', 'error');
            return;
        }

        var archiveName = document.getElementById('compressArchiveName').value || 'archive.zip';
        var format = document.getElementById('compressFormat').value;
        var outputDir = document.getElementById('compressOutputDir').value || null;
        var dryRun = document.getElementById('compressDryRun').checked;

        // Construct target path
        var targetPath = outputDir ? outputDir + '/' + archiveName : archiveName;

        // Show loading
        Utils.showToast('Compressing ' + selectedFiles.length + ' files...', 'info');

        API.compressFiles(scanId, selectedFiles, targetPath, format, dryRun)
            .then(function(result) {
                bootstrap.Modal.getInstance(document.getElementById('compressModal')).hide();
                
                if (result.success) {
                    Utils.showToast('Successfully compressed files to: ' + result.target_path, 'success');
                    showTransformResult([result]);
                } else {
                    Utils.showToast('Compression failed: ' + result.error, 'error');
                }
                
                // Clear selection
                clearSelection();
            })
            .catch(function(error) {
                Utils.showToast('Compression error: ' + error.message, 'error');
            });
    };

    /**
     * Open convert modal
     */
    window.openConvertModal = function() {
        if (selectedFiles.length === 0) {
            Utils.showToast('Please select image files from the tree first', 'error');
            return;
        }

        document.getElementById('convertFileCount').textContent = selectedFiles.length;
        var modal = new bootstrap.Modal(document.getElementById('convertModal'));
        modal.show();
    };

    /**
     * Execute convert operation
     */
    window.executeConvert = function() {
        var scanId = API.getCurrentScan();
        if (!scanId) {
            Utils.showToast('No scan selected', 'error');
            return;
        }

        var format = document.getElementById('convertFormat').value;
        var outputDir = document.getElementById('convertOutputDir').value || null;
        var dryRun = document.getElementById('convertDryRun').checked;

        // Show loading
        Utils.showToast('Converting ' + selectedFiles.length + ' images...', 'info');

        API.convertImages(scanId, selectedFiles, format, outputDir, dryRun)
            .then(function(result) {
                bootstrap.Modal.getInstance(document.getElementById('convertModal')).hide();
                
                var results = result.results || [];
                var successCount = results.filter(function(r) { return r.success; }).length;
                
                Utils.showToast('Converted ' + successCount + ' of ' + selectedFiles.length + ' images', 'success');
                showTransformResult(results);
                
                // Clear selection
                clearSelection();
            })
            .catch(function(error) {
                Utils.showToast('Conversion error: ' + error.message, 'error');
            });
    };

    /**
     * Open resize modal
     */
    window.openResizeModal = function() {
        if (selectedFiles.length === 0) {
            Utils.showToast('Please select image files from the tree first', 'error');
            return;
        }

        document.getElementById('resizeFileCount').textContent = selectedFiles.length;
        var modal = new bootstrap.Modal(document.getElementById('resizeModal'));
        modal.show();
    };

    /**
     * Execute resize operation
     */
    window.executeResize = function() {
        var scanId = API.getCurrentScan();
        if (!scanId) {
            Utils.showToast('No scan selected', 'error');
            return;
        }

        var maxWidth = parseInt(document.getElementById('resizeMaxWidth').value) || 1920;
        var maxHeight = parseInt(document.getElementById('resizeMaxHeight').value) || 1080;
        var outputDir = document.getElementById('resizeOutputDir').value || null;
        var dryRun = document.getElementById('resizeDryRun').checked;

        // Show loading
        Utils.showToast('Resizing ' + selectedFiles.length + ' images...', 'info');

        API.resizeImages(scanId, selectedFiles, maxWidth, maxHeight, outputDir, dryRun)
            .then(function(result) {
                bootstrap.Modal.getInstance(document.getElementById('resizeModal')).hide();
                
                var results = result.results || [];
                var successCount = results.filter(function(r) { return r.success; }).length;
                
                Utils.showToast('Resized ' + successCount + ' of ' + selectedFiles.length + ' images', 'success');
                showTransformResult(results);
                
                // Clear selection
                clearSelection();
            })
            .catch(function(error) {
                Utils.showToast('Resize error: ' + error.message, 'error');
            });
    };

    /**
     * Show transform results
     * @param {Array} results - Transform results
     */
    function showTransformResult(results) {
        var container = document.getElementById('transformResults');
        var content = document.getElementById('transformResultsContent');
        
        if (!container || !content) return;

        var html = '<div class="table-responsive mt-3">';
        html += '<table class="table table-sm">';
        html += '<thead><tr>';
        html += '<th>Status</th>';
        html += '<th>Source</th>';
        html += '<th>Target</th>';
        html += '<th>Error</th>';
        html += '</tr></thead><tbody>';

        results.forEach(function(result) {
            var statusIcon = result.success ? 
                '<i class="fas fa-check-circle text-success"></i>' : 
                '<i class="fas fa-times-circle text-danger"></i>';
            
            html += '<tr>';
            html += '<td>' + statusIcon + '</td>';
            html += '<td class="text-truncate" style="max-width: 300px;" title="' + result.source_path + '">' + result.source_path + '</td>';
            html += '<td class="text-truncate" style="max-width: 300px;" title="' + (result.target_path || '-') + '">' + (result.target_path || '-') + '</td>';
            html += '<td class="text-danger">' + (result.error || '-') + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        
        content.innerHTML = html;
        container.style.display = 'block';
    }

    /**
     * Delete scan (exposed globally)
     */
    window.deleteScan = function(scanId) {
        if (!confirm('Are you sure you want to delete this scan?')) {
            return;
        }

        API.deleteScan(scanId)
            .then(function() {
                Utils.showToast('Scan deleted', 'success');
                if (API.getCurrentScan() === scanId) {
                    API.clearCurrentScan();
                }
                loadScans();
            })
            .catch(function(error) {
                Utils.showToast('Failed to delete scan: ' + error.message, 'error');
            });
    };

    // Initialize when components are loaded
    window.onComponentsLoaded = init;
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', function() {
        if (scanStatusInterval) {
            clearInterval(scanStatusInterval);
        }
        if (ws) {
            ws.close();
        }
    });
})();