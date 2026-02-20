/**
 * DirStudio — pages/organize.js
 *
 * Controls the Organize tab:
 *   - Duplicates sub-tab (load, render, select-all, delete)
 *   - AI Suggestions sub-tab (generate, render, copy path, toggle file list)
 *
 * Depends on: Utils, API, Store
 */

var OrganizePage = (function () {
    'use strict';

    /* ── Public: wire up buttons after HTML is injected ────────────────── */
    function init() {
        var selectBtn   = document.getElementById('selectAllDuplicatesBtn');
        var cleanBtn    = document.getElementById('cleanDuplicatesBtn');
        var aiBtn       = document.getElementById('generateAISuggestionsBtn');

        if (selectBtn) selectBtn.addEventListener('click', _selectAllDuplicates);
        if (cleanBtn)  cleanBtn.addEventListener('click',  _cleanDuplicates);
        if (aiBtn)     aiBtn.addEventListener('click',     _generateAISuggestions);
    }

    /* ── Public: load duplicates for a scan ────────────────────────────── */
    function load(scanId) {
        API.getDuplicates(scanId, { detect_exact: true, detect_near: true })
            .then(_renderDuplicates)
            .catch(function (e) { console.error('Duplicates error:', e); });
    }

    /* ── Duplicates ────────────────────────────────────────────────────── */
    function _renderDuplicates(data) {
        var el = document.getElementById('duplicateGroups');
        if (!el) return;
        var html = '';

        if (data.statistics) {
            var s = data.statistics;
            html += '<div class="analysis-section mb-4">' +
                '<h5 class="mb-3"><i class="fas fa-chart-bar me-2"></i>Analysis</h5>' +
                '<div class="row g-3">';
            [
                { icon: 'fa-copy',       label: 'Exact Groups',      val: s.exact_duplicate_groups || 0 },
                { icon: 'fa-clone',      label: 'Near-Dup Groups',   val: s.near_duplicate_groups  || 0 },
                { icon: 'fa-trash',      label: 'Wasted Space',      val: Math.ceil((s.total_wastage_bytes || 0) / 1e6) + ' MB' },
                { icon: 'fa-piggy-bank', label: 'Potential Savings', val: Math.ceil(s.potential_savings_mb || 0) + ' MB' }
            ].forEach(function (item) {
                html += '<div class="col-md-3"><div class="stat-card">' +
                    '<div class="stat-icon stat-icon--files"><i class="fas ' + item.icon + '"></i></div>' +
                    '<div class="stat-content"><div class="stat-label">' + item.label + '</div>' +
                    '<div class="stat-value" style="font-size:22px">' + item.val + '</div></div></div></div>';
            });
            html += '</div></div>';
        }

        var groups = Object.values(data.exact_duplicates || {}).concat(Object.values(data.near_duplicates || {}));

        if (!groups.length) {
            html += '<div class="empty-state"><i class="fas fa-check-circle"></i><p>No duplicates found!</p></div>';
        } else {
            html += '<h5 class="mb-3"><i class="fas fa-copy me-2"></i>Duplicate Groups</h5>';
            groups.forEach(function (g) {
                var files = g.files || [];
                var cls   = g.duplicate_type === 'exact' ? 'danger' : 'warning';
                html += '<div class="duplicate-group border-' + cls + '">' +
                    '<div class="duplicate-header">' +
                        '<strong><span class="badge bg-' + cls + '">' + g.duplicate_type + '</span> ' + files.length + ' files</strong>' +
                        '<span>Wastage: ' + Utils.formatBytes(g.wastage || 0) + '</span>' +
                    '</div><div class="duplicate-files">';
                files.forEach(function (f) {
                    var p = f.path || f;
                    html += '<div class="duplicate-file">' +
                        '<input type="checkbox" class="form-check-input" data-file-path="' + _esc(p) + '">' +
                        '<i class="fas ' + Utils.getFileIcon(_ext(p)) + '"></i>' +
                        '<span>' + _esc(p) + '</span>' +
                        '</div>';
                });
                html += '</div></div>';
            });
        }

        el.innerHTML = html;
    }

    function _selectAllDuplicates() {
        document.querySelectorAll('#duplicateGroups input[type="checkbox"]')
            .forEach(function (cb) { cb.checked = true; });
    }

    function _cleanDuplicates() {
        var scanId = API.getCurrentScan();
        if (!scanId) return Utils.showToast('No scan selected', 'error');

        var paths = Array.from(
            document.querySelectorAll('#duplicateGroups input[type="checkbox"]:checked')
        ).map(function (cb) { return cb.getAttribute('data-file-path'); });

        if (!paths.length) return Utils.showToast('No files selected', 'error');
        if (!confirm('Delete ' + paths.length + ' file(s)?')) return;

        API.deleteFiles(scanId, paths, false).then(function (res) {
            var ok = res.results.filter(function (r) { return r.success; }).length;
            Utils.showToast('Deleted ' + ok + '/' + paths.length, 'success');
            load(scanId);
        });
    }

    /* ── AI Suggestions ────────────────────────────────────────────────── */
    function _generateAISuggestions() {
        var scanId = API.getCurrentScan();
        if (!scanId) return Utils.showToast('No scan selected', 'error');

        var el = document.getElementById('aiSuggestionsContent');
        if (el) el.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Analysing with AI…</p></div>';

        API.getOrganizeSuggestions(scanId)
            .then(_renderAISuggestions)
            .catch(function (e) {
                if (el) el.innerHTML = '<div class="alert alert-danger"><i class="fas fa-triangle-exclamation me-2"></i>' + _esc(e.message) + '</div>';
            });
    }

    function _renderAISuggestions(report) {
        var el   = document.getElementById('aiSuggestionsContent');
        if (!el) return;

        var sugg = report.suggestions || [];
        if (!sugg.length) {
            el.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><p>No suggestions — already well organised!</p></div>';
            return;
        }

        var html =
            '<div class="ai-suggestions-header">' +
            '<div class="ai-badge"><i class="fas fa-sparkles"></i>AI-Powered Analysis</div>' +
            '<div class="ai-stats">' +
                '<span><i class="fas fa-lightbulb me-1"></i>' + sugg.length + ' suggestions</span>' +
                '<span><i class="fas fa-file me-1"></i>' + report.statistics.total_files + ' files</span>' +
            '</div></div>';

        sugg.forEach(function (s, i) {
            var pct = Math.round(s.confidence * 100);
            var cls = pct >= 95 ? 'success' : pct >= 85 ? 'warning' : 'info';
            var sp  = s.target_path.split('/').slice(-2).join('/') || s.target_path;

            html += '<div class="suggestion-card">' +
                '<div class="suggestion-header">' +
                    '<div class="suggestion-title">' +
                        '<span class="suggestion-number">' + (i + 1) + '</span>' +
                        '<i class="fas fa-folder-tree"></i>' +
                        '<strong>' + _esc(sp) + '</strong>' +
                    '</div>' +
                    '<span class="badge bg-' + cls + '">' + pct + '% confident</span>' +
                '</div>' +
                '<div class="suggestion-reason"><i class="fas fa-quote-left me-2"></i>' + _esc(s.reason) + '</div>';

            if (s.file_count > 0) {
                html += '<div class="suggestion-files">' +
                    '<div class="files-summary">' +
                        '<span><i class="fas fa-files me-2"></i><strong>' + s.file_count + ' files</strong> to move</span>' +
                        '<button class="btn btn-sm btn-link" data-sugg-idx="' + i + '" data-action="toggle">' +
                            '<i class="fas fa-chevron-down"></i> Show' +
                        '</button>' +
                    '</div>' +
                    '<div class="files-list" id="sf-' + i + '" style="display:none">';
                (s.files || []).forEach(function (f) {
                    html += '<div class="file-item"><i class="fas ' + Utils.getFileIcon(_ext(f)) + ' me-2"></i><span>' + _esc(f) + '</span></div>';
                });
                html += '</div></div>';
            }

            html += '<div class="suggestion-actions">' +
                '<button class="btn btn-sm btn-outline-primary" data-copy-path="' + _esc(s.target_path) + '">' +
                    '<i class="fas fa-copy me-1"></i>Copy path' +
                '</button>' +
            '</div></div>';
        });

        el.innerHTML = html;

        /* Wire toggle buttons */
        el.querySelectorAll('[data-action="toggle"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx  = btn.dataset.suggIdx;
                var list = document.getElementById('sf-' + idx);
                if (!list) return;
                var vis  = list.style.display !== 'none';
                list.style.display = vis ? 'none' : 'block';
                btn.innerHTML = '<i class="fas fa-chevron-' + (vis ? 'down' : 'up') + '"></i> ' + (vis ? 'Show' : 'Hide');
            });
        });

        /* Wire copy-path buttons */
        el.querySelectorAll('[data-copy-path]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var p = btn.getAttribute('data-copy-path');
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(p).then(function () { Utils.showToast('Copied!', 'success'); });
                } else {
                    Utils.showToast(p, 'info');
                }
            });
        });
    }

    /* ── Micro helpers ─────────────────────────────────────────────────── */
    function _ext(name) {
        if (!name) return '';
        var p = String(name).split('.');
        return p.length > 1 ? p[p.length - 1].toLowerCase() : '';
    }

    function _esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    /* ── Public API ────────────────────────────────────────────────────── */
    return {
        init: init,
        load: load
    };
})();
