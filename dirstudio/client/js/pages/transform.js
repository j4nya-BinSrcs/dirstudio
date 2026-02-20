/**
 * DirStudio — pages/transform.js
 *
 * Controls the Transform tab:
 *   - Compress, Convert, Resize modals
 *   - File selection via modal trees (delegates to TreePage.buildModalTree)
 *   - API calls and results table
 *
 * Depends on: Utils, API, Store, TreePage
 */

var TransformPage = (function () {
    'use strict';

    /* ── Public: wire buttons after HTML is injected ───────────────────── */
    function init() {
        _bind('openCompressBtn',   function () { _openModal('compressModal', 'compressTreeContainer', 'compress'); });
        _bind('openConvertBtn',    function () { _openModal('convertModal',  'convertTreeContainer',  'convert');  });
        _bind('openResizeBtn',     function () { _openModal('resizeModal',   'resizeTreeContainer',   'resize');   });
        _bind('executeCompressBtn', _executeCompress);
        _bind('executeConvertBtn',  _executeConvert);
        _bind('executeResizeBtn',   _executeResize);
    }

    function _bind(id, fn) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    }

    /* ── Modal open ────────────────────────────────────────────────────── */
    function _openModal(modalId, treeContainerId, treeType) {
        /* Reset selection state for this modal */
        var mf = Store.get('modalFiles');
        mf[treeType] = [];
        Store.merge('modalFiles', mf);

        var countEl = document.getElementById(treeType + 'FileCount');
        if (countEl) countEl.textContent = '0';

        /* Render the tree inside the modal */
        TreePage.buildModalTree(Store.get('currentTreeData'), treeContainerId, treeType);

        /* Show the Bootstrap modal */
        var modalEl = document.getElementById(modalId);
        if (modalEl) new bootstrap.Modal(modalEl).show();
    }

    /* ── Execute: Compress ─────────────────────────────────────────────── */
    function _executeCompress() {
        var files = (Store.get('modalFiles') || {}).compress || [];
        if (!files.length) return Utils.showToast('Select files first', 'error');

        var scanId = API.getCurrentScan();
        if (!scanId) return Utils.showToast('No scan selected', 'error');

        var name   = _val('compressArchiveName') || 'archive.zip';
        var fmt    = _val('compressFormat');
        var outDir = _val('compressOutputDir') || null;
        var dry    = _checked('compressDryRun');
        var target = outDir ? outDir + '/' + name : name;

        Utils.showToast('Compressing…', 'info');
        API.compressFiles(scanId, files, target, fmt, dry).then(function (res) {
            _hideModal('compressModal');
            if (res.success) Utils.showToast('Compressed: ' + res.target_path, 'success');
            else             Utils.showToast('Error: ' + res.error, 'error');
            _showResults([res]);
        }).catch(function (e) { Utils.showToast('Compress failed: ' + e.message, 'error'); });
    }

    /* ── Execute: Convert ──────────────────────────────────────────────── */
    function _executeConvert() {
        var files = (Store.get('modalFiles') || {}).convert || [];
        if (!files.length) return Utils.showToast('Select files first', 'error');

        var scanId = API.getCurrentScan();
        if (!scanId) return Utils.showToast('No scan selected', 'error');

        var fmt = _val('convertFormat');
        var out = _val('convertOutputDir') || null;
        var dry = _checked('convertDryRun');

        Utils.showToast('Converting…', 'info');
        API.convertImages(scanId, files, fmt, out, dry).then(function (res) {
            _hideModal('convertModal');
            var ok = res.results.filter(function (r) { return r.success; }).length;
            Utils.showToast('Converted ' + ok + ' files', 'success');
            _showResults(res.results);
        }).catch(function (e) { Utils.showToast('Convert failed: ' + e.message, 'error'); });
    }

    /* ── Execute: Resize ───────────────────────────────────────────────── */
    function _executeResize() {
        var files = (Store.get('modalFiles') || {}).resize || [];
        if (!files.length) return Utils.showToast('Select files first', 'error');

        var scanId = API.getCurrentScan();
        if (!scanId) return Utils.showToast('No scan selected', 'error');

        var w   = parseInt(_val('resizeMaxWidth'),  10) || 1920;
        var h   = parseInt(_val('resizeMaxHeight'), 10) || 1080;
        var out = _val('resizeOutputDir') || null;
        var dry = _checked('resizeDryRun');

        Utils.showToast('Resizing…', 'info');
        API.resizeImages(scanId, files, w, h, out, dry).then(function (res) {
            _hideModal('resizeModal');
            var ok = res.results.filter(function (r) { return r.success; }).length;
            Utils.showToast('Resized ' + ok + ' files', 'success');
            _showResults(res.results);
        }).catch(function (e) { Utils.showToast('Resize failed: ' + e.message, 'error'); });
    }

    /* ── Results table ─────────────────────────────────────────────────── */
    function _showResults(results) {
        var wrap = document.getElementById('transformResults');
        var body = document.getElementById('transformResultsContent');
        if (!wrap || !body) return;

        var html =
            '<div class="table-responsive"><table class="table table-sm">' +
            '<thead><tr><th>Status</th><th>Source</th><th>Target</th><th>Error</th></tr></thead><tbody>';

        results.forEach(function (r) {
            var icon = r.success
                ? '<i class="fas fa-check-circle text-success"></i>'
                : '<i class="fas fa-times-circle text-danger"></i>';
            html += '<tr><td>' + icon + '</td>' +
                '<td class="text-truncate" style="max-width:260px" title="' + _esc(r.source_path || '') + '">' + _esc(r.source_path || '') + '</td>' +
                '<td class="text-truncate" style="max-width:260px" title="' + _esc(r.target_path || '-') + '">' + _esc(r.target_path || '-') + '</td>' +
                '<td class="text-danger small">' + _esc(r.error || '-') + '</td></tr>';
        });

        html += '</tbody></table></div>';
        body.innerHTML = html;
        wrap.style.display = 'block';
    }

    /* ── DOM helpers ───────────────────────────────────────────────────── */
    function _val(id) {
        var el = document.getElementById(id);
        return el ? el.value : '';
    }

    function _checked(id) {
        var el = document.getElementById(id);
        return el ? el.checked : false;
    }

    function _hideModal(id) {
        var el = document.getElementById(id);
        if (el) {
            var m = bootstrap.Modal.getInstance(el);
            if (m) m.hide();
        }
    }

    function _esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    /* ── Public API ────────────────────────────────────────────────────── */
    return { init: init };
})();
