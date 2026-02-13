/**
 * DirStudio - Simplified with Prompt-only and Beautiful AI Suggestions
 */

(function() {
    'use strict';

    var ws = null;
    var scanStatusInterval = null;
    var selectedFiles = [];
    var currentTreeData = null;
    var pieChartInstance = null;
    var snapshots = {};
    var modalSelectedFiles = {};

    function init() {
        Utils.setTheme(Utils.getPreferredTheme());

        var themeBtn = document.getElementById('themeToggleBtn');
        if (themeBtn) {
            themeBtn.addEventListener('click', Utils.toggleTheme);
        }

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
     * Simplified directory picker - PROMPT ONLY
     */
    function initDirectoryPicker() {
        setTimeout(function() {
            var uploadZone = document.getElementById('uploadZone');
            
            if (!uploadZone) {
                console.error('Upload zone not found');
                return;
            }

            // Click opens prompt
            uploadZone.addEventListener('click', function(e) {
                e.preventDefault();
                promptForDirectory();
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
                promptForDirectory();
            });

            console.log('Directory picker initialized (prompt-only mode)');
        }, 500);
    }

    /**
     * Prompt for directory path
     */
    function promptForDirectory() {
        var path = prompt(
            'Enter the directory path to scan:\n\n' +
            'You can use \\, /, or \\\\ as separators.\n\n' +
            'Examples:\n' +
            '  C:\\Users\\YourName\\Documents\n' +
            '  /home/yourname/projects\n' +
            '  Z:/projects/myproject',
            localStorage.getItem('lastScanPath') || ''
        );
        
        if (path && Utils.isValidPath(path)) {
            // Normalize and save
            path = Utils.normalizePath(path);
            localStorage.setItem('lastScanPath', path);
            createScanFromPath(path);
        } else if (path) {
            Utils.showToast('Invalid path provided', 'error');
        }
    }

    function createScanFromPath(path) {
        console.log('Creating scan from path:', path);
        Utils.showToast('Starting scan: ' + path, 'info');

        API.createScan(path)
            .then(function(response) {
                Utils.showToast('Scan created successfully!', 'success');
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

    function loadOverview(scanId) {
        API.getScanOverview(scanId)
            .then(function(data) {
                updateOverview(data);
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

    function renderPieChart(extensions) {
        var canvas = document.getElementById('fileTypeChart');
        if (!canvas) return;

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

        extensions.slice(0, 10).forEach(function(ext) {
            labels.push('.' + (ext.ext || 'unknown'));
            data.push(ext.count);
        });

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
                            font: { size: 11, family: 'Inter' }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                var value = context.parsed || 0;
                                var total = context.dataset.data.reduce(function(a, b) { return a + b; }, 0);
                                var percentage = ((value / total) * 100).toFixed(1);
                                return context.label + ': ' + value + ' (' + percentage + '%)';
                            }
                        }
                    }
                }
            }
        });
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
            html += '<span><i class="fas ' + Utils.getFileIcon(ext.ext) + '"></i> .' + (ext.ext || 'unknown') + '</span>';
            html += '<span>' + Utils.formatNumber(ext.count) + ' files</span>';
            html += '</div>';
        });
        extList.innerHTML = html;
    }

    function loadDuplicates(scanId) {
        API.getDuplicates(scanId, { detect_exact: true, detect_near: true })
            .then(renderDuplicates)
            .catch(function(error) {
                console.error('Failed to load duplicates:', error);
            });
    }

    function renderDuplicates(data) {
        var container = document.getElementById('duplicateGroups');
        if (!container) return;

        var allGroups = Object.values(data.exact_duplicates || {}).concat(Object.values(data.near_duplicates || {}));

        if (allGroups.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><p>No duplicates found</p></div>';
            return;
        }

        var html = '';
        allGroups.forEach(function(group) {
            var files = group.files || [];
            var typeClass = group.duplicate_type === 'exact' ? 'danger' : 'warning';
            
            html += '<div class="duplicate-group border-' + typeClass + '">';
            html += '<div class="duplicate-header"><strong><span class="badge bg-' + typeClass + '">' + group.duplicate_type + '</span> ' + files.length + ' duplicates</strong>';
            html += '<span>Wastage: ' + Utils.formatBytes(group.wastage || 0) + '</span></div><div class="duplicate-files">';
            
            files.forEach(function(file) {
                var filePath = file.path || file;
                html += '<div class="duplicate-file"><input type="checkbox" class="form-check-input" data-file-path="' + filePath + '">';
                html += '<i class="fas ' + Utils.getFileIcon(Utils.getExtension(filePath)) + '"></i> <span>' + filePath + '</span></div>';
            });
            html += '</div></div>';
        });
        container.innerHTML = html;
        
        if (data.statistics) {
            var stats = data.statistics;
            var analysisContainer = document.getElementById('analysisStats');
            if (analysisContainer) {
                analysisContainer.innerHTML = 
                    '<div class="row g-3">' +
                    '<div class="col-md-6"><div class="stat-card"><div class="stat-icon"><i class="fas fa-copy"></i></div><div class="stat-content"><div class="stat-label">Exact Duplicates</div><div class="stat-value">' + (stats.exact_duplicate_groups || 0) + '</div></div></div></div>' +
                    '<div class="col-md-6"><div class="stat-card"><div class="stat-icon"><i class="fas fa-clone"></i></div><div class="stat-content"><div class="stat-label">Near Duplicates</div><div class="stat-value">' + (stats.near_duplicate_groups || 0) + '</div></div></div></div>' +
                    '<div class="col-md-6"><div class="stat-card"><div class="stat-icon"><i class="fas fa-trash"></i></div><div class="stat-content"><div class="stat-label">Wasted Space</div><div class="stat-value" style="font-size:20px;">' + Utils.formatBytes(stats.total_wastage || 0) + '</div></div></div></div>' +
                    '<div class="col-md-6"><div class="stat-card"><div class="stat-icon"><i class="fas fa-file-alt"></i></div><div class="stat-content"><div class="stat-label">Files Scanned</div><div class="stat-value" style="font-size:20px;">' + Utils.formatNumber(stats.total_files_scanned || 0) + '</div></div></div></div>' +
                    '</div>';
            }
        }
    }

    function loadTree(scanId) {
        API.getTree(scanId)
            .then(function(response) {
                var rootNode = response.root || response;
                if (!rootNode || !rootNode.path) throw new Error('Invalid tree response');
                currentTreeData = normalizeFsNode(rootNode);
                renderTree(currentTreeData, 'directoryTree', 'main');
            })
            .catch(function(error) {
                console.error('Error loading tree:', error);
                document.getElementById('directoryTree').innerHTML = '<div class="alert alert-danger">Failed to load tree</div>';
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
                        size: file.metadata?.size || 0
                    });
                });
            }
            return { type: 'directory', name: name, path: node.path, size: node.metadata?.size || 0, children: children };
        }
        return null;
    }

    function renderTree(tree, containerId, treeType) {
        var container = document.getElementById(containerId);
        if (!container) return;
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

        var html = '<div class="tree-node" data-node-id="' + nodeId + '"><div class="tree-node-content" style="padding-left:' + (depth * 16) + 'px">';
        if (hasChildren) {
            html += '<i class="fas ' + (isExpanded ? 'fa-chevron-down expanded' : 'fa-chevron-right') + ' tree-toggle" data-node-id="' + nodeId + '"></i>';
        } else {
            html += '<span class="tree-spacer"></span>';
        }
        if (node.type === 'file') {
            html += '<input type="checkbox" class="tree-checkbox me-2" data-file-path="' + node.path + '" data-tree-type="' + treeType + '" onchange="handleFileSelection(this, \'' + treeType + '\')">';
            html += '<i class="fas fa-file tree-icon file-icon"></i>';
        } else {
            html += '<i class="fas fa-folder tree-icon folder-icon"></i>';
        }
        html += '<span class="tree-label">' + node.name + '</span><span class="text-muted ms-2">(' + Utils.formatBytes(node.size || 0) + ')</span></div>';
        if (hasChildren) {
            html += '<div class="tree-children" data-parent="' + nodeId + '"' + (isExpanded ? '' : ' style="display:none"') + '>';
            node.children.forEach(function(child) {
                html += buildTreeHTML(child, depth + 1, false, treeType);
            });
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    function attachTreeHandlers(container) {
        container.querySelectorAll('.tree-toggle').forEach(function(toggle) {
            toggle.addEventListener('click', function(e) {
                e.stopPropagation();
                var children = container.querySelector('.tree-children[data-parent="' + this.dataset.nodeId + '"]');
                if (!children) return;
                var expanded = this.classList.contains('expanded');
                children.style.display = expanded ? 'none' : 'block';
                this.classList.toggle('expanded');
                this.classList.toggle('fa-chevron-down');
                this.classList.toggle('fa-chevron-right');
            });
        });
    }

    window.handleFileSelection = function(checkbox, treeType) {
        var filePath = checkbox.getAttribute('data-file-path');
        if (treeType === 'main') {
            if (checkbox.checked) {
                if (selectedFiles.indexOf(filePath) === -1) selectedFiles.push(filePath);
            } else {
                var index = selectedFiles.indexOf(filePath);
                if (index > -1) selectedFiles.splice(index, 1);
            }
            updateSelectedCount();
        } else {
            if (!modalSelectedFiles[treeType]) modalSelectedFiles[treeType] = [];
            if (checkbox.checked) {
                if (modalSelectedFiles[treeType].indexOf(filePath) === -1) modalSelectedFiles[treeType].push(filePath);
            } else {
                var idx = modalSelectedFiles[treeType].indexOf(filePath);
                if (idx > -1) modalSelectedFiles[treeType].splice(idx, 1);
            }
            updateModalCount(treeType);
        }
    };

    function updateSelectedCount() {
        var countEl = document.getElementById('selectedFilesCount');
        if (countEl) countEl.textContent = selectedFiles.length + ' selected';
    }

    function updateModalCount(modalType) {
        var count = modalSelectedFiles[modalType] ? modalSelectedFiles[modalType].length : 0;
        if (modalType === 'compress') document.getElementById('compressFileCount').textContent = count;
        else if (modalType === 'convert') document.getElementById('convertFileCount').textContent = count;
        else if (modalType === 'resize') document.getElementById('resizeFileCount').textContent = count;
    }

    window.clearSelection = function() {
        selectedFiles = [];
        document.querySelectorAll('.tree-checkbox[data-tree-type="main"]').forEach(function(cb) { cb.checked = false; });
        updateSelectedCount();
    };

    window.selectDirectory = function() {
        promptForDirectory();
    };

    window.selectAllDuplicates = function() {
        document.querySelectorAll('#duplicateGroups input[type="checkbox"]').forEach(function(cb) { cb.checked = true; });
    };

    window.cleanDuplicates = function() {
        var scanId = API.getCurrentScan();
        if (!scanId) return Utils.showToast('No scan selected', 'error');
        var checkboxes = document.querySelectorAll('#duplicateGroups input[type="checkbox"]:checked');
        var filePaths = Array.from(checkboxes).map(function(cb) { return cb.getAttribute('data-file-path'); });
        if (filePaths.length === 0) return Utils.showToast('No files selected', 'error');
        if (!confirm('Delete ' + filePaths.length + ' files?')) return;
        API.deleteFiles(scanId, filePaths, false).then(function(result) {
            var successCount = result.results.filter(function(r) { return r.success; }).length;
            Utils.showToast('Deleted ' + successCount + ' of ' + filePaths.length + ' files', 'success');
            loadDuplicates(scanId);
        });
    };

    /**
     * BEAUTIFUL AI SUGGESTIONS RENDERING
     */
    window.generateAISuggestions = function() {
        var scanId = API.getCurrentScan();
        if (!scanId) return Utils.showToast('No scan selected', 'error');
        
        var container = document.getElementById('aiSuggestionsContent');
        container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Analyzing directory structure with AI...</p></div>';
        
        API.getOrganizeSuggestions(scanId)
            .then(function(report) {
                renderAISuggestions(report);
            })
            .catch(function(error) {
                container.innerHTML = '<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-2"></i>' + error.message + '</div>';
            });
    };

    function renderAISuggestions(report) {
        var container = document.getElementById('aiSuggestionsContent');
        if (!container) return;

        if (!report.suggestions || report.suggestions.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><p>No organization suggestions</p><small class="text-muted">Your files are already well organized!</small></div>';
            return;
        }

        var html = '<div class="ai-suggestions-header">';
        html += '<div class="ai-badge"><i class="fas fa-sparkles me-2"></i>AI-Powered Analysis</div>';
        html += '<div class="ai-stats">';
        html += '<span><i class="fas fa-lightbulb me-1"></i>' + report.suggestions.length + ' suggestions</span>';
        html += '<span><i class="fas fa-file me-1"></i>' + report.statistics.total_files + ' files analyzed</span>';
        html += '<span><i class="fas fa-brain me-1"></i>Model: ' + report.model + '</span>';
        html += '</div></div>';

        report.suggestions.forEach(function(suggestion, index) {
            var confidencePercent = Math.round(suggestion.confidence * 100);
            var confidenceClass = confidencePercent >= 95 ? 'success' : confidencePercent >= 85 ? 'warning' : 'info';
            
            html += '<div class="suggestion-card">';
            html += '<div class="suggestion-header">';
            html += '<div class="suggestion-title">';
            html += '<span class="suggestion-number">#' + (index + 1) + '</span>';
            html += '<i class="fas fa-folder-tree me-2"></i>';
            html += '<strong>' + getShortPath(suggestion.target_path) + '</strong>';
            html += '</div>';
            html += '<span class="badge bg-' + confidenceClass + '">' + confidencePercent + '% confident</span>';
            html += '</div>';
            
            html += '<div class="suggestion-reason">';
            html += '<i class="fas fa-quote-left me-2"></i>';
            html += suggestion.reason;
            html += '</div>';
            
            if (suggestion.file_count > 0) {
                html += '<div class="suggestion-files">';
                html += '<div class="files-summary">';
                html += '<i class="fas fa-files me-2"></i>';
                html += '<strong>' + suggestion.file_count + ' files</strong> will be moved';
                html += '<button class="btn btn-sm btn-link" onclick="toggleFiles(' + index + ')"><i class="fas fa-chevron-down"></i> Show files</button>';
                html += '</div>';
                
                html += '<div class="files-list" id="files-' + index + '" style="display:none;">';
                suggestion.files.forEach(function(file) {
                    var ext = Utils.getExtension(file);
                    html += '<div class="file-item">';
                    html += '<i class="fas ' + Utils.getFileIcon(ext) + ' me-2"></i>';
                    html += '<span>' + file + '</span>';
                    html += '</div>';
                });
                html += '</div>';
                html += '</div>';
            } else {
                html += '<div class="suggestion-note">';
                html += '<i class="fas fa-info-circle me-2"></i>';
                html += '<em>This folder can be removed (empty or redundant)</em>';
                html += '</div>';
            }
            
            html += '<div class="suggestion-actions">';
            html += '<button class="btn btn-sm btn-outline-primary" onclick="copySuggestionPath(\'' + suggestion.target_path + '\')"><i class="fas fa-copy me-1"></i>Copy Path</button>';
            html += '</div>';
            
            html += '</div>';
        });

        container.innerHTML = html;
    }

    function getShortPath(fullPath) {
        var parts = fullPath.split('/');
        if (parts.length > 3) {
            return '.../' + parts.slice(-2).join('/');
        }
        return parts.slice(-2).join('/') || fullPath;
    }

    window.toggleFiles = function(index) {
        var filesList = document.getElementById('files-' + index);
        var btn = event.target.closest('button');
        if (filesList) {
            var isVisible = filesList.style.display !== 'none';
            filesList.style.display = isVisible ? 'none' : 'block';
            if (btn) {
                var icon = btn.querySelector('i');
                if (icon) {
                    icon.className = isVisible ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
                }
                btn.innerHTML = icon.outerHTML + (isVisible ? ' Show files' : ' Hide files');
            }
        }
    };

    window.copySuggestionPath = function(path) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(path).then(function() {
                Utils.showToast('Path copied to clipboard!', 'success');
            });
        } else {
            Utils.showToast('Path: ' + path, 'info');
        }
    };

    // Transform operations
    window.openCompressModal = function() {
        modalSelectedFiles['compress'] = [];
        if (currentTreeData) renderTree(currentTreeData, 'compressTreeContainer', 'compress');
        else document.getElementById('compressTreeContainer').innerHTML = '<div class="empty-state"><p>No scan loaded</p></div>';
        updateModalCount('compress');
        new bootstrap.Modal(document.getElementById('compressModal')).show();
    };

    window.openConvertModal = function() {
        modalSelectedFiles['convert'] = [];
        if (currentTreeData) renderTree(currentTreeData, 'convertTreeContainer', 'convert');
        else document.getElementById('convertTreeContainer').innerHTML = '<div class="empty-state"><p>No scan loaded</p></div>';
        updateModalCount('convert');
        new bootstrap.Modal(document.getElementById('convertModal')).show();
    };

    window.openResizeModal = function() {
        modalSelectedFiles['resize'] = [];
        if (currentTreeData) renderTree(currentTreeData, 'resizeTreeContainer', 'resize');
        else document.getElementById('resizeTreeContainer').innerHTML = '<div class="empty-state"><p>No scan loaded</p></div>';
        updateModalCount('resize');
        new bootstrap.Modal(document.getElementById('resizeModal')).show();
    };

    window.executeCompress = function() {
        var files = modalSelectedFiles['compress'] || [];
        if (files.length === 0) return Utils.showToast('Select files first', 'error');
        var scanId = API.getCurrentScan();
        if (!scanId) return Utils.showToast('No scan selected', 'error');
        var archiveName = document.getElementById('compressArchiveName').value || 'archive.zip';
        var format = document.getElementById('compressFormat').value;
        var outputDir = document.getElementById('compressOutputDir').value || null;
        var dryRun = document.getElementById('compressDryRun').checked;
        var targetPath = outputDir ? outputDir + '/' + archiveName : archiveName;
        Utils.showToast('Compressing...', 'info');
        API.compressFiles(scanId, files, targetPath, format, dryRun).then(function(result) {
            bootstrap.Modal.getInstance(document.getElementById('compressModal')).hide();
            if (result.success) {
                Utils.showToast('Compressed: ' + result.target_path, 'success');
                showTransformResult([result]);
            } else {
                Utils.showToast('Failed: ' + result.error, 'error');
            }
            modalSelectedFiles['compress'] = [];
        });
    };

    window.executeConvert = function() {
        var files = modalSelectedFiles['convert'] || [];
        if (files.length === 0) return Utils.showToast('Select files first', 'error');
        var scanId = API.getCurrentScan();
        if (!scanId) return Utils.showToast('No scan selected', 'error');
        var format = document.getElementById('convertFormat').value;
        var outputDir = document.getElementById('convertOutputDir').value || null;
        var dryRun = document.getElementById('convertDryRun').checked;
        Utils.showToast('Converting...', 'info');
        API.convertImages(scanId, files, format, outputDir, dryRun).then(function(result) {
            bootstrap.Modal.getInstance(document.getElementById('convertModal')).hide();
            var successCount = result.results.filter(function(r) { return r.success; }).length;
            Utils.showToast('Converted ' + successCount + ' files', 'success');
            showTransformResult(result.results);
            modalSelectedFiles['convert'] = [];
        });
    };

    window.executeResize = function() {
        var files = modalSelectedFiles['resize'] || [];
        if (files.length === 0) return Utils.showToast('Select files first', 'error');
        var scanId = API.getCurrentScan();
        if (!scanId) return Utils.showToast('No scan selected', 'error');
        var maxWidth = parseInt(document.getElementById('resizeMaxWidth').value) || 1920;
        var maxHeight = parseInt(document.getElementById('resizeMaxHeight').value) || 1080;
        var outputDir = document.getElementById('resizeOutputDir').value || null;
        var dryRun = document.getElementById('resizeDryRun').checked;
        Utils.showToast('Resizing...', 'info');
        API.resizeImages(scanId, files, maxWidth, maxHeight, outputDir, dryRun).then(function(result) {
            bootstrap.Modal.getInstance(document.getElementById('resizeModal')).hide();
            var successCount = result.results.filter(function(r) { return r.success; }).length;
            Utils.showToast('Resized ' + successCount + ' files', 'success');
            showTransformResult(result.results);
            modalSelectedFiles['resize'] = [];
        });
    };

    function showTransformResult(results) {
        var container = document.getElementById('transformResults');
        var content = document.getElementById('transformResultsContent');
        if (!container || !content) return;
        var html = '<div class="table-responsive mt-3"><table class="table table-sm"><thead><tr><th>Status</th><th>Source</th><th>Target</th><th>Error</th></tr></thead><tbody>';
        results.forEach(function(result) {
            var icon = result.success ? '<i class="fas fa-check-circle text-success"></i>' : '<i class="fas fa-times-circle text-danger"></i>';
            html += '<tr><td>' + icon + '</td><td class="text-truncate" style="max-width:300px;" title="' + result.source_path + '">' + result.source_path + '</td>';
            html += '<td class="text-truncate" style="max-width:300px;" title="' + (result.target_path || '-') + '">' + (result.target_path || '-') + '</td>';
            html += '<td class="text-danger">' + (result.error || '-') + '</td></tr>';
        });
        html += '</tbody></table></div>';
        content.innerHTML = html;
        container.style.display = 'block';
    }

    // Snapshots
    function loadSnapshots() {
        var container = document.getElementById('snapshotsList');
        if (!container) return;
        var scanId = API.getCurrentScan();
        var scanSnapshots = scanId ? snapshots[scanId] || [] : [];
        if (scanSnapshots.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-camera"></i><p>No snapshots yet</p><small>Create a snapshot to save current state</small></div>';
            return;
        }
        var html = '';
        scanSnapshots.forEach(function(snapshot, index) {
            html += '<div class="snapshot-card"><div class="snapshot-header"><div><i class="fas fa-camera me-2"></i><strong>' + snapshot.name + '</strong></div><div class="snapshot-actions">';
            html += '<button class="btn btn-sm btn-outline-primary me-2" onclick="viewSnapshot(' + index + ')"><i class="fas fa-eye"></i></button>';
            html += '<button class="btn btn-sm btn-outline-warning me-2" onclick="revertToSnapshot(' + index + ')"><i class="fas fa-undo"></i></button>';
            html += '<button class="btn btn-sm btn-outline-danger" onclick="deleteSnapshot(' + index + ')"><i class="fas fa-trash"></i></button></div></div>';
            html += '<div class="snapshot-meta"><small class="text-muted"><i class="fas fa-clock me-1"></i>' + new Date(snapshot.timestamp).toLocaleString() + ' | <i class="fas fa-file me-1"></i>' + snapshot.fileCount + ' files | <i class="fas fa-database me-1"></i>' + Utils.formatBytes(snapshot.totalSize) + '</small></div>';
            if (snapshot.description) html += '<div class="snapshot-desc"><small>' + snapshot.description + '</small></div>';
            html += '</div>';
        });
        container.innerHTML = html;
    }

    window.createSnapshot = function() {
        var scanId = API.getCurrentScan();
        if (!scanId) return Utils.showToast('No scan selected', 'error');
        var name = prompt('Snapshot name:', 'Snapshot ' + new Date().toLocaleDateString());
        if (!name) return;
        var description = prompt('Description (optional):', '');
        API.getScanOverview(scanId).then(function(data) {
            if (!snapshots[scanId]) snapshots[scanId] = [];
            snapshots[scanId].push({ name: name, description: description, timestamp: Date.now(), scanId: scanId, fileCount: data.total_files, totalSize: data.total_size, data: currentTreeData });
            Utils.showToast('Snapshot created!', 'success');
            loadSnapshots();
        });
    };

    window.viewSnapshot = function(index) {
        var snapshot = snapshots[API.getCurrentScan()][index];
        alert('Snapshot: ' + snapshot.name + '\n\nCreated: ' + new Date(snapshot.timestamp).toLocaleString() + '\nFiles: ' + snapshot.fileCount + '\nSize: ' + Utils.formatBytes(snapshot.totalSize) + (snapshot.description ? '\nDescription: ' + snapshot.description : ''));
    };

    window.revertToSnapshot = function(index) {
        var snapshot = snapshots[API.getCurrentScan()][index];
        if (!confirm('Revert to "' + snapshot.name + '"?')) return;
        currentTreeData = snapshot.data;
        renderTree(currentTreeData, 'directoryTree', 'main');
        Utils.showToast('Reverted to: ' + snapshot.name, 'success');
    };

    window.deleteSnapshot = function(index) {
        var scanId = API.getCurrentScan();
        if (!confirm('Delete snapshot "' + snapshots[scanId][index].name + '"?')) return;
        snapshots[scanId].splice(index, 1);
        Utils.showToast('Snapshot deleted', 'success');
        loadSnapshots();
    };

    window.deleteScan = function(scanId) {
        if (!confirm('Delete this scan?')) return;
        API.deleteScan(scanId).then(function() {
            Utils.showToast('Scan deleted', 'success');
            if (API.getCurrentScan() === scanId) API.clearCurrentScan();
            delete snapshots[scanId];
            loadScans();
        });
    };

    window.onComponentsLoaded = init;
    window.addEventListener('beforeunload', function() {
        if (scanStatusInterval) clearInterval(scanStatusInterval);
        if (ws) ws.close();
    });
})();