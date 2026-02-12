/**
 * DirStudio - FIXED Implementation
 * All features working: Directory picker, Drag&Drop, Pie Chart, Side Trees
 */

(function() {
    'use strict';

    var ws = null;
    var scanStatusInterval = null;
    var selectedFiles = [];
    var currentTreeData = null;
    var pieChartInstance = null;
    var snapshots = {};
    var modalSelectedFiles = {}; // Separate selection state for modals

    function init() {
        Utils.setTheme(Utils.getPreferredTheme());

        var themeBtn = document.getElementById('themeToggleBtn');
        if (themeBtn) {
            themeBtn.addEventListener('click', Utils.toggleTheme);
        }

        // Initialize directory picker and drag-drop
        initDirectoryPicker();

        console.log('DirStudio initialized');
        loadScans();
        loadGlobalStats();
        loadSnapshots();
        
        var currentScan = API.getCurrentScan();
        if (currentScan) {
            loadScan(currentScan);
        }
    }

    /**
     * Initialize native directory picker + drag and drop
     */
    function initDirectoryPicker() {
        setTimeout(function() {
            var uploadZone = document.getElementById('uploadZone');
            var directoryPicker = document.getElementById('directoryPicker');
            
            if (!uploadZone || !directoryPicker) {
                console.error('Upload zone or directory picker not found');
                return;
            }

            // Click to open native directory picker
            uploadZone.addEventListener('click', function(e) {
                if (e.target.id !== 'directoryPicker') {
                    directoryPicker.click();
                }
            });

            // Handle directory selection
            directoryPicker.addEventListener('change', function(e) {
                var files = e.target.files;
                if (files.length > 0) {
                    var path = files[0].webkitRelativePath || files[0].name;
                    var dirPath = path.split('/')[0];
                    
                    // Get full path from user
                    var fullPath = prompt('Directory selected: "' + dirPath + '"\n\nPlease enter the full absolute path:', '');
                    if (fullPath && Utils.isValidPath(fullPath)) {
                        createScanFromPath(fullPath);
                    } else if (fullPath) {
                        Utils.showToast('Invalid path provided', 'error');
                    }
                }
            });

            // Drag and drop
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function(eventName) {
                uploadZone.addEventListener(eventName, function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                }, false);
            });

            uploadZone.addEventListener('dragenter', function() {
                uploadZone.classList.add('drag-over');
            });

            uploadZone.addEventListener('dragleave', function(e) {
                if (e.target === uploadZone) {
                    uploadZone.classList.remove('drag-over');
                }
            });

            uploadZone.addEventListener('drop', function(e) {
                uploadZone.classList.remove('drag-over');
                
                var items = e.dataTransfer.items;
                if (items && items.length > 0) {
                    var item = items[0].webkitGetAsEntry();
                    if (item && item.isDirectory) {
                        var fullPath = prompt('Folder detected!\n\nPlease enter the full absolute path to: ' + item.name, '');
                        if (fullPath && Utils.isValidPath(fullPath)) {
                            createScanFromPath(fullPath);
                        }
                    } else {
                        Utils.showToast('Please drop a folder, not a file', 'error');
                    }
                } else {
                    Utils.showToast('Please drop a folder', 'error');
                }
            });

            console.log('Directory picker and drag-drop initialized');
        }, 500);
    }

    function createScanFromPath(path) {
        Utils.showToast('Starting scan...', 'info');

        API.createScan(path)
            .then(function(response) {
                Utils.showToast('Scan created: ' + response.scan_id, 'success');
                loadScans();
                setTimeout(function() {
                    loadScan(response.scan_id);
                }, 1000);
            })
            .catch(function(error) {
                Utils.showToast('Failed to create scan: ' + error.message, 'error');
            });
    }

    function loadGlobalStats() {
        API.getGlobalStats()
            .then(function(stats) {
                console.log('Global stats:', stats);
            })
            .catch(function(error) {
                console.error('Failed to load global stats:', error);
            });
    }

    function loadScans() {
        API.getAllScans()
            .then(function(scans) {
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

    window.loadScanFromCard = function(event, scanId) {
        event.stopPropagation();
        loadScan(scanId);
    };

    function getPathName(path) {
        if (!path) return 'Unknown';
        var parts = path.replace(/\\/g, '/').split('/');
        return parts[parts.length - 1] || parts[parts.length - 2] || 'Root';
    }

    function loadScan(scanId) {
        API.setCurrentScan(scanId);
        
        var cards = document.querySelectorAll('.scan-card');
        cards.forEach(function(card) {
            card.classList.remove('active');
            if (card.getAttribute('data-scan-id') === scanId) {
                card.classList.add('active');
            }
        });

        if (scanStatusInterval) {
            clearInterval(scanStatusInterval);
            scanStatusInterval = null;
        }

        API.getScan(scanId)
            .then(function(scan) {
                console.log('Scan status:', scan);
                
                if (scan.status === 'running' || scan.status === 'pending') {
                    pollScanStatus(scanId);
                    Utils.showToast('Scan is ' + scan.status + '...', 'info');
                } else if (scan.status === 'completed') {
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

    function pollScanStatus(scanId) {
        scanStatusInterval = setInterval(function() {
            API.getScan(scanId)
                .then(function(scan) {
                    if (scan.status === 'completed') {
                        clearInterval(scanStatusInterval);
                        scanStatusInterval = null;
                        Utils.showToast('Scan completed!', 'success');
                        loadScanData(scanId);
                        loadScans();
                    } else if (scan.status === 'failed') {
                        clearInterval(scanStatusInterval);
                        scanStatusInterval = null;
                        Utils.showToast('Scan failed: ' + (scan.error || 'Unknown error'), 'error');
                    }
                })
                .catch(function(error) {
                    console.error('Polling error:', error);
                });
        }, 2000);
    }

    function loadScanData(scanId) {
        loadOverview(scanId);
        loadTree(scanId);
        loadDuplicates(scanId);
    }

    /**
     * Load overview with WORKING PIE CHART
     */
    function loadOverview(scanId) {
        API.getScanOverview(scanId)
            .then(function(data) {
                console.log('Overview data:', data);
                updateOverview(data);
                
                // Render pie chart with actual data
                if (data.top_extensions && data.top_extensions.length > 0) {
                    renderPieChart(data.top_extensions);
                }
                
                renderFileTypes(data.top_extensions || []);
            })
            .catch(function(error) {
                console.error('Failed to load overview:', error);
                Utils.showToast('Failed to load overview: ' + error.message, 'error');
            });
    }

    function updateOverview(data) {
        document.getElementById('totalFiles').textContent = Utils.formatNumber(data.total_files || 0);
        document.getElementById('totalSize').textContent = Utils.formatBytes(data.total_size || 0);
        document.getElementById('totalDirs').textContent = Utils.formatNumber(data.total_dirs || 0);
    }

    /**
     * WORKING PIE CHART with Chart.js
     */
    function renderPieChart(extensions) {
        var canvas = document.getElementById('fileTypeChart');
        if (!canvas) {
            console.error('Canvas not found');
            return;
        }

        // Destroy existing chart
        if (pieChartInstance) {
            pieChartInstance.destroy();
            pieChartInstance = null;
        }

        if (!extensions || extensions.length === 0) {
            canvas.style.display = 'none';
            return;
        }

        canvas.style.display = 'block';

        var labels = [];
        var data = [];
        var colors = [
            '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
            '#10b981', '#06b6d4', '#ef4444', '#f97316',
            '#84cc16', '#14b8a6', '#a855f7', '#eab308'
        ];

        // Take top 10 extensions
        extensions.slice(0, 10).forEach(function(ext) {
            labels.push('.' + (ext.ext || 'unknown'));
            data.push(ext.count);
        });

        console.log('Creating pie chart with:', { labels: labels, data: data });

        try {
            var ctx = canvas.getContext('2d');
            pieChartInstance = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: colors,
                        borderWidth: 2,
                        borderColor: '#ffffff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                padding: 10,
                                font: {
                                    size: 11,
                                    family: 'Inter'
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    var label = context.label || '';
                                    var value = context.parsed || 0;
                                    var total = context.dataset.data.reduce(function(a, b) { return a + b; }, 0);
                                    var percentage = ((value / total) * 100).toFixed(1);
                                    return label + ': ' + value + ' files (' + percentage + '%)';
                                }
                            }
                        }
                    }
                }
            });
            
            console.log('Pie chart created successfully');
        } catch (error) {
            console.error('Error creating pie chart:', error);
        }
    }

    function renderFileTypes(extensions) {
        var extList = document.getElementById('extensionsList');
        if (!extList) return;

        if (extensions.length === 0) {
            extList.innerHTML = '<div class="empty-state"><p>No data</p></div>';
            return;
        }

        var html = '';
        extensions.forEach(function(ext) {
            html += '<div class="list-item">';
            html += '<span><i class="fas ' + Utils.getFileIcon(ext.ext) + '"></i> .' + 
                    (ext.ext || 'unknown') + '</span>';
            html += '<span>' + Utils.formatNumber(ext.count) + ' files</span>';
            html += '</div>';
        });

        extList.innerHTML = html;
    }

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
     */
    function loadTree(scanId) {
        API.getTree(scanId)
            .then(function(response) {
                console.log('Tree response:', response);
                var rootNode = response.root ? response.root : response;
                if (!rootNode || !rootNode.path) {
                    throw new Error('Invalid tree response');
                }
                var treeRoot = normalizeFsNode(rootNode);
                currentTreeData = treeRoot;
                console.log('Normalized tree:', treeRoot);
                renderTree(treeRoot, 'directoryTree', 'main');
            })
            .catch(function(error) {
                console.error('Error loading tree:', error);
                var el = document.getElementById('directoryTree');
                if (el) {
                    el.innerHTML = '<div class="alert alert-danger">Failed to load directory tree</div>';
                }
            });
    }

    function normalizeFsNode(node) {
        if (!node || !node.path) return null;
        var name = node.path.split(/[\\/]/).pop();

        if (node.subdirs || node.files) {
            var children = [];
            if (Array.isArray(node.subdirs)) {
                node.subdirs.forEach(function(subdir) {
                    var child = normalizeFsNode(subdir);
                    if (child) children.push(child);
                });
            }
            if (Array.isArray(node.files)) {
                node.files.forEach(function(file) {
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
                name: name,
                path: node.path,
                size: node.metadata?.size || 0,
                children: children
            };
        }
        return null;
    }

    /**
     * Render tree - works for both main tree and modal trees
     */
    function renderTree(tree, containerId, treeType) {
        var container = document.getElementById(containerId);
        if (!container) {
            console.error('Container not found:', containerId);
            return;
        }

        if (!tree) {
            container.innerHTML = '<div class="empty-state"><p>No tree data</p></div>';
            return;
        }

        container.innerHTML = buildTreeHTML(tree, 0, true, treeType);
        attachTreeHandlers(container, treeType);
    }

    function buildTreeHTML(node, depth, isRoot, treeType) {
        if (!node) return '';
        
        var nodeId = 'node-' + treeType + '-' + Math.random().toString(36).slice(2);
        var hasChildren = Array.isArray(node.children) && node.children.length > 0;
        var isExpanded = isRoot === true;

        var html = '<div class="tree-node" data-node-id="' + nodeId + '">';
        html += '<div class="tree-node-content" style="padding-left:' + (depth * 16) + 'px">';

        if (hasChildren) {
            html += '<i class="fas ' +
                (isExpanded ? 'fa-chevron-down expanded' : 'fa-chevron-right') +
                ' tree-toggle" data-node-id="' + nodeId + '"></i>';
        } else {
            html += '<span class="tree-spacer"></span>';
        }

        if (node.type === 'file') {
            html += '<input type="checkbox" class="tree-checkbox me-2" ' +
                   'data-file-path="' + node.path + '" ' +
                   'data-tree-type="' + treeType + '" ' +
                   'onchange="handleFileSelection(this, \'' + treeType + '\')">';
            html += '<i class="fas fa-file tree-icon file-icon"></i>';
        } else {
            html += '<i class="fas fa-folder tree-icon folder-icon"></i>';
        }

        html += '<span class="tree-label">' + node.name + '</span>';
        html += '<span class="text-muted ms-2">(' + Utils.formatBytes(node.size || 0) + ')</span>';
        html += '</div>';

        if (hasChildren) {
            html += '<div class="tree-children" data-parent="' + nodeId + '"' +
                (isExpanded ? '' : ' style="display:none"') + '>';
            node.children.forEach(function(child) {
                html += buildTreeHTML(child, depth + 1, false, treeType);
            });
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function attachTreeHandlers(container, treeType) {
        container.querySelectorAll('.tree-toggle').forEach(function(toggle) {
            toggle.addEventListener('click', function(e) {
                e.stopPropagation();
                var nodeId = this.dataset.nodeId;
                var children = container.querySelector('.tree-children[data-parent="' + nodeId + '"]');
                if (!children) return;

                var expanded = this.classList.contains('expanded');
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
     * Handle file selection - works for both main and modal trees
     */
    window.handleFileSelection = function(checkbox, treeType) {
        var filePath = checkbox.getAttribute('data-file-path');
        
        if (treeType === 'main') {
            // Main tree selection
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
        } else {
            // Modal tree selection
            if (!modalSelectedFiles[treeType]) {
                modalSelectedFiles[treeType] = [];
            }
            
            if (checkbox.checked) {
                if (modalSelectedFiles[treeType].indexOf(filePath) === -1) {
                    modalSelectedFiles[treeType].push(filePath);
                }
            } else {
                var idx = modalSelectedFiles[treeType].indexOf(filePath);
                if (idx > -1) {
                    modalSelectedFiles[treeType].splice(idx, 1);
                }
            }
            updateModalCount(treeType);
        }
    };

    function updateSelectedCount() {
        var countEl = document.getElementById('selectedFilesCount');
        if (countEl) {
            countEl.textContent = selectedFiles.length + ' selected';
        }
    }

    function updateModalCount(modalType) {
        var count = modalSelectedFiles[modalType] ? modalSelectedFiles[modalType].length : 0;
        
        if (modalType === 'compress') {
            document.getElementById('compressFileCount').textContent = count;
        } else if (modalType === 'convert') {
            document.getElementById('convertFileCount').textContent = count;
        } else if (modalType === 'resize') {
            document.getElementById('resizeFileCount').textContent = count;
        }
    }

    window.clearSelection = function() {
        selectedFiles = [];
        var checkboxes = document.querySelectorAll('.tree-checkbox[data-tree-type="main"]');
        checkboxes.forEach(function(cb) {
            cb.checked = false;
        });
        updateSelectedCount();
    };

    window.selectDirectory = function() {
        var picker = document.getElementById('directoryPicker');
        if (picker) {
            picker.click();
        }
    };

    window.selectAllDuplicates = function() {
        var checkboxes = document.querySelectorAll('#duplicateGroups input[type="checkbox"]');
        checkboxes.forEach(function(cb) {
            cb.checked = true;
        });
    };

    window.cleanDuplicates = function() {
        var scanId = API.getCurrentScan();
        if (!scanId) {
            Utils.showToast('No scan selected', 'error');
            return;
        }

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

    // ========== TRANSFORM OPERATIONS with WORKING SIDE TREES ==========

    window.openCompressModal = function() {
        modalSelectedFiles['compress'] = [];
        if (currentTreeData) {
            renderTree(currentTreeData, 'compressTreeContainer', 'compress');
        } else {
            document.getElementById('compressTreeContainer').innerHTML = '<div class="empty-state"><p>No scan loaded</p></div>';
        }
        updateModalCount('compress');
        var modal = new bootstrap.Modal(document.getElementById('compressModal'));
        modal.show();
    };

    window.openConvertModal = function() {
        modalSelectedFiles['convert'] = [];
        if (currentTreeData) {
            renderTree(currentTreeData, 'convertTreeContainer', 'convert');
        } else {
            document.getElementById('convertTreeContainer').innerHTML = '<div class="empty-state"><p>No scan loaded</p></div>';
        }
        updateModalCount('convert');
        var modal = new bootstrap.Modal(document.getElementById('convertModal'));
        modal.show();
    };

    window.openResizeModal = function() {
        modalSelectedFiles['resize'] = [];
        if (currentTreeData) {
            renderTree(currentTreeData, 'resizeTreeContainer', 'resize');
        } else {
            document.getElementById('resizeTreeContainer').innerHTML = '<div class="empty-state"><p>No scan loaded</p></div>';
        }
        updateModalCount('resize');
        var modal = new bootstrap.Modal(document.getElementById('resizeModal'));
        modal.show();
    };

    window.executeCompress = function() {
        var files = modalSelectedFiles['compress'] || [];
        
        if (files.length === 0) {
            Utils.showToast('Please select files from the tree', 'error');
            return;
        }

        var scanId = API.getCurrentScan();
        if (!scanId) {
            Utils.showToast('No scan selected', 'error');
            return;
        }

        var archiveName = document.getElementById('compressArchiveName').value || 'archive.zip';
        var format = document.getElementById('compressFormat').value;
        var outputDir = document.getElementById('compressOutputDir').value || null;
        var dryRun = document.getElementById('compressDryRun').checked;
        var targetPath = outputDir ? outputDir + '/' + archiveName : archiveName;

        Utils.showToast('Compressing ' + files.length + ' files...', 'info');

        API.compressFiles(scanId, files, targetPath, format, dryRun)
            .then(function(result) {
                bootstrap.Modal.getInstance(document.getElementById('compressModal')).hide();
                
                if (result.success) {
                    Utils.showToast('Successfully compressed to: ' + result.target_path, 'success');
                    showTransformResult([result]);
                } else {
                    Utils.showToast('Compression failed: ' + result.error, 'error');
                }
                
                modalSelectedFiles['compress'] = [];
            })
            .catch(function(error) {
                Utils.showToast('Compression error: ' + error.message, 'error');
            });
    };

    window.executeConvert = function() {
        var files = modalSelectedFiles['convert'] || [];
        
        if (files.length === 0) {
            Utils.showToast('Please select image files from the tree', 'error');
            return;
        }

        var scanId = API.getCurrentScan();
        if (!scanId) {
            Utils.showToast('No scan selected', 'error');
            return;
        }

        var format = document.getElementById('convertFormat').value;
        var outputDir = document.getElementById('convertOutputDir').value || null;
        var dryRun = document.getElementById('convertDryRun').checked;

        Utils.showToast('Converting ' + files.length + ' images...', 'info');

        API.convertImages(scanId, files, format, outputDir, dryRun)
            .then(function(result) {
                bootstrap.Modal.getInstance(document.getElementById('convertModal')).hide();
                
                var results = result.results || [];
                var successCount = results.filter(function(r) { return r.success; }).length;
                
                Utils.showToast('Converted ' + successCount + ' of ' + files.length + ' images', 'success');
                showTransformResult(results);
                
                modalSelectedFiles['convert'] = [];
            })
            .catch(function(error) {
                Utils.showToast('Conversion error: ' + error.message, 'error');
            });
    };

    window.executeResize = function() {
        var files = modalSelectedFiles['resize'] || [];
        
        if (files.length === 0) {
            Utils.showToast('Please select image files from the tree', 'error');
            return;
        }

        var scanId = API.getCurrentScan();
        if (!scanId) {
            Utils.showToast('No scan selected', 'error');
            return;
        }

        var maxWidth = parseInt(document.getElementById('resizeMaxWidth').value) || 1920;
        var maxHeight = parseInt(document.getElementById('resizeMaxHeight').value) || 1080;
        var outputDir = document.getElementById('resizeOutputDir').value || null;
        var dryRun = document.getElementById('resizeDryRun').checked;

        Utils.showToast('Resizing ' + files.length + ' images...', 'info');

        API.resizeImages(scanId, files, maxWidth, maxHeight, outputDir, dryRun)
            .then(function(result) {
                bootstrap.Modal.getInstance(document.getElementById('resizeModal')).hide();
                
                var results = result.results || [];
                var successCount = results.filter(function(r) { return r.success; }).length;
                
                Utils.showToast('Resized ' + successCount + ' of ' + files.length + ' images', 'success');
                showTransformResult(results);
                
                modalSelectedFiles['resize'] = [];
            })
            .catch(function(error) {
                Utils.showToast('Resize error: ' + error.message, 'error');
            });
    };

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

    // ========== SNAPSHOTS ==========

    function loadSnapshots() {
        var container = document.getElementById('snapshotsList');
        if (!container) return;

        var scanId = API.getCurrentScan();
        var scanSnapshots = scanId ? snapshots[scanId] || [] : [];

        if (scanSnapshots.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-camera"></i><p>No snapshots yet</p><small class="text-muted">Create a snapshot to save the current state</small></div>';
            return;
        }

        var html = '';
        scanSnapshots.forEach(function(snapshot, index) {
            html += '<div class="snapshot-card">';
            html += '<div class="snapshot-header">';
            html += '<div><i class="fas fa-camera me-2"></i><strong>' + snapshot.name + '</strong></div>';
            html += '<div class="snapshot-actions">';
            html += '<button class="btn btn-sm btn-outline-primary me-2" onclick="viewSnapshot(' + index + ')" title="View Details"><i class="fas fa-eye"></i></button>';
            html += '<button class="btn btn-sm btn-outline-warning me-2" onclick="revertToSnapshot(' + index + ')" title="Revert"><i class="fas fa-undo"></i></button>';
            html += '<button class="btn btn-sm btn-outline-danger" onclick="deleteSnapshot(' + index + ')" title="Delete"><i class="fas fa-trash"></i></button>';
            html += '</div></div>';
            html += '<div class="snapshot-meta">';
            html += '<small class="text-muted">';
            html += '<i class="fas fa-clock me-1"></i>' + new Date(snapshot.timestamp).toLocaleString() + ' | ';
            html += '<i class="fas fa-file me-1"></i>' + snapshot.fileCount + ' files | ';
            html += '<i class="fas fa-database me-1"></i>' + Utils.formatBytes(snapshot.totalSize);
            html += '</small>';
            html += '</div>';
            if (snapshot.description) {
                html += '<div class="snapshot-desc"><small>' + snapshot.description + '</small></div>';
            }
            html += '</div>';
        });

        container.innerHTML = html;
    }

    window.createSnapshot = function() {
        var scanId = API.getCurrentScan();
        if (!scanId) {
            Utils.showToast('No scan selected', 'error');
            return;
        }

        var name = prompt('Snapshot name:', 'Snapshot ' + (new Date().toLocaleDateString()));
        if (!name) return;

        var description = prompt('Description (optional):', '');

        API.getScanOverview(scanId)
            .then(function(data) {
                var snapshot = {
                    name: name,
                    description: description,
                    timestamp: Date.now(),
                    scanId: scanId,
                    fileCount: data.total_files,
                    totalSize: data.total_size,
                    data: currentTreeData
                };

                if (!snapshots[scanId]) {
                    snapshots[scanId] = [];
                }
                snapshots[scanId].push(snapshot);

                Utils.showToast('Snapshot created successfully!', 'success');
                loadSnapshots();
            })
            .catch(function(error) {
                Utils.showToast('Failed to create snapshot: ' + error.message, 'error');
            });
    };

    window.viewSnapshot = function(index) {
        var scanId = API.getCurrentScan();
        var snapshot = snapshots[scanId][index];
        
        var info = 'Snapshot: ' + snapshot.name + '\n\n';
        info += 'Created: ' + new Date(snapshot.timestamp).toLocaleString() + '\n';
        info += 'Files: ' + snapshot.fileCount + '\n';
        info += 'Size: ' + Utils.formatBytes(snapshot.totalSize) + '\n';
        if (snapshot.description) {
            info += 'Description: ' + snapshot.description;
        }
        
        alert(info);
    };

    window.revertToSnapshot = function(index) {
        var scanId = API.getCurrentScan();
        var snapshot = snapshots[scanId][index];
        
        if (!confirm('Revert to snapshot "' + snapshot.name + '"? This will restore the directory tree view.')) {
            return;
        }

        currentTreeData = snapshot.data;
        renderTree(currentTreeData, 'directoryTree', 'main');
        Utils.showToast('Reverted to snapshot: ' + snapshot.name, 'success');
    };

    window.deleteSnapshot = function(index) {
        var scanId = API.getCurrentScan();
        var snapshot = snapshots[scanId][index];
        
        if (!confirm('Delete snapshot "' + snapshot.name + '"?')) {
            return;
        }

        snapshots[scanId].splice(index, 1);
        Utils.showToast('Snapshot deleted', 'success');
        loadSnapshots();
    };

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
                delete snapshots[scanId];
                loadScans();
            })
            .catch(function(error) {
                Utils.showToast('Failed to delete scan: ' + error.message, 'error');
            });
    };

    window.onComponentsLoaded = init;
    
    window.addEventListener('beforeunload', function() {
        if (scanStatusInterval) {
            clearInterval(scanStatusInterval);
        }
        if (ws) {
            ws.close();
        }
    });
})();