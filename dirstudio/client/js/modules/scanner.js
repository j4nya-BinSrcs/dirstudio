/**
 * DirStudio — scanner.js
 *
 * Owns the scan lifecycle:
 *   - Upload-zone wiring (drag-drop, folder picker, path prompt)
 *   - Scan creation → polling → completion
 *   - Scan-history sidebar rendering
 *
 * Depends on: Utils, API, Store
 * Fires: onScanReady(scanId) when a scan finishes and data is ready to load.
 */

var Scanner = (function () {
    'use strict';

    /* ── Callback ──────────────────────────────────────────────────────── */
    var _onScanReady = null;

    /** Register the callback invoked when a scan completes. */
    function onScanReady(fn) { _onScanReady = fn; }

    function fireScanReady(scanId) {
        if (typeof _onScanReady === 'function') _onScanReady(scanId);
    }

    /* ── Upload zone ───────────────────────────────────────────────────── */
    function initUploadZone() {
        /* Components load asynchronously — poll until the zone exists */
        var attempts = 0;
        var t = setInterval(function () {
            var zone = document.getElementById('uploadZone');
            if (!zone) { if (++attempts > 50) clearInterval(t); return; }
            clearInterval(t);
            _wireZone(zone);
        }, 100);
    }

    function _wireZone(zone) {
        var folderBtn   = document.getElementById('folderPickerBtn');
        var pathBtn     = document.getElementById('pathPromptBtn');
        var folderInput = document.getElementById('folderInput');

        /* Drag events */
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function (ev) {
            zone.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); });
        });
        zone.addEventListener('dragenter', function () { zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', function (e) {
            if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
        });
        zone.addEventListener('drop', function () {
            zone.classList.remove('drag-over');
            _promptForPath();
        });

        /* Bare zone click → prompt */
        zone.addEventListener('click', function (e) {
            if (e.target.closest('.upload-btn')) return;
            _promptForPath();
        });

        /* Folder picker button */
        if (folderBtn && folderInput) {
            folderBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                folderInput.click();
            });
            folderInput.addEventListener('change', function () {
                if (this.files && this.files.length > 0) {
                    var rel  = this.files[0].webkitRelativePath || '';
                    var root = rel.split('/')[0] || '';
                    var pre  = localStorage.getItem('lastScanPath') || root;
                    var confirmed = prompt(
                        'Browser security limits access to the full path.\n' +
                        'Please confirm or complete the path for "' + root + '":',
                        pre
                    );
                    if (confirmed && Utils.isValidPath(confirmed)) {
                        startScan(Utils.normalizePath(confirmed));
                    }
                }
                this.value = '';
            });
        }

        /* Path prompt button */
        if (pathBtn) {
            pathBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                _promptForPath();
            });
        }
    }

    function _promptForPath() {
        var path = prompt(
            'Enter the directory path to scan:\n\n' +
            'Examples:\n  C:\\Users\\Name\\Documents\n  /home/name/projects',
            localStorage.getItem('lastScanPath') || ''
        );
        if (!path) return;
        path = path.trim();
        if (Utils.isValidPath(path)) {
            startScan(Utils.normalizePath(path));
        } else {
            Utils.showToast('Invalid path — please check and try again', 'error');
        }
    }

    /* ── Start a scan ──────────────────────────────────────────────────── */
    function startScan(path) {
        localStorage.setItem('lastScanPath', path);
        Utils.showToast('Starting scan: ' + path, 'info');
        API.createScan(path)
            .then(function (res) {
                Utils.showToast('Scan started!', 'success');
                loadScans();
                setTimeout(function () { loadScan(res.scan_id); }, 800);
            })
            .catch(function (err) {
                Utils.showToast('Scan failed: ' + err.message, 'error');
            });
    }

    /* ── Load & poll a scan ────────────────────────────────────────────── */
    function loadScan(scanId) {
        API.setCurrentScan(scanId);
        Store.set('currentScanId', scanId);

        /* Highlight active card in sidebar */
        document.querySelectorAll('.scan-card').forEach(function (c) {
            c.classList.toggle('active', c.dataset.scanId === scanId);
        });

        /* Clear any existing poll */
        var existing = Store.get('pollTimer');
        if (existing) { clearInterval(existing); Store.set('pollTimer', null); }

        API.getScan(scanId)
            .then(function (scan) {
                Store.set('currentScanMeta', scan);
                if (scan.status === 'completed') {
                    fireScanReady(scanId);
                } else if (scan.status === 'running' || scan.status === 'pending') {
                    Utils.showToast('Scan is ' + scan.status + '…', 'info');
                    _pollScan(scanId);
                } else if (scan.status === 'failed') {
                    Utils.showToast('Scan failed: ' + (scan.error || 'unknown error'), 'error');
                }
            })
            .catch(function (err) {
                Utils.showToast('Load error: ' + err.message, 'error');
            });
    }

    function _pollScan(scanId) {
        var timer = setInterval(function () {
            API.getScan(scanId).then(function (scan) {
                if (scan.status === 'completed') {
                    clearInterval(timer);
                    Store.set('pollTimer', null);
                    Store.set('currentScanMeta', scan);
                    Utils.showToast('Scan complete!', 'success');
                    loadScans();
                    fireScanReady(scanId);
                } else if (scan.status === 'failed') {
                    clearInterval(timer);
                    Store.set('pollTimer', null);
                    Utils.showToast('Scan failed: ' + (scan.error || 'unknown'), 'error');
                }
            }).catch(console.error);
        }, 2000);
        Store.set('pollTimer', timer);
    }

    /* ── Scan history sidebar ──────────────────────────────────────────── */
    function loadScans() {
        API.getAllScans()
            .then(function (scans) {
                scans.sort(function (a, b) {
                    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
                });
                _renderScanHistory(scans);
            })
            .catch(function (err) {
                Utils.showToast('Could not load scans: ' + err.message, 'error');
            });
    }

    function _renderScanHistory(scans) {
        var el = document.getElementById('scanHistoryList');
        if (!el) return;

        if (!scans.length) {
            el.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>No scans yet</p></div>';
            return;
        }

        var html = '';
        scans.forEach(function (s) {
            var cls = { completed: 'success', running: 'info', failed: 'danger' }[s.status] || 'secondary';
            html += '<div class="scan-card" data-scan-id="' + s.scan_id + '">' +
                '<div class="scan-name"><i class="fas fa-folder"></i>' + _esc(pathName(s.path)) + '</div>' +
                '<div class="scan-path" title="' + _esc(s.path) + '">' + _esc(s.path) + '</div>' +
                '<div class="scan-meta"><span class="badge bg-' + cls + '">' + s.status + '</span></div>' +
                '</div>';
        });
        el.innerHTML = html;

        /* Wire click on each card */
        el.querySelectorAll('.scan-card').forEach(function (card) {
            card.addEventListener('click', function (e) {
                e.stopPropagation();
                _showTab('overview');
                loadScan(card.dataset.scanId);
            });
        });
    }

    /* ── Helpers ───────────────────────────────────────────────────────── */
    function pathName(path) {
        if (!path) return 'Unknown';
        var p = path.replace(/\\/g, '/').split('/');
        return p[p.length - 1] || p[p.length - 2] || 'Root';
    }

    function _showTab(id) {
        var btn = document.querySelector('[data-bs-target="#' + id + '"]');
        if (btn) new bootstrap.Tab(btn).show();
    }

    function _esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /* ── Public API ────────────────────────────────────────────────────── */
    return {
        init           : initUploadZone,
        loadScans      : loadScans,
        loadScan       : loadScan,
        onScanReady    : onScanReady,
        pathName       : pathName
    };
})();
