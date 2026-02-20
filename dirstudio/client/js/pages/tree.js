/**
 * DirStudio — pages/tree.js
 *
 * Controls the Tree tab:
 *   - Directory tree (no checkboxes, click → preview panel)
 *   - Expand / Collapse all toolbar
 *   - File/folder preview panel
 *   - Shared modal-tree builder (WITH checkboxes, used by transform modals)
 *
 * Depends on: Utils, API, Store
 */

var TreePage = (function () {
    'use strict';

    /* ── Public: initialise toolbar buttons ────────────────────────────── */
    function init() {
        var exp  = document.getElementById('treeExpandAll');
        var coll = document.getElementById('treeCollapseAll');
        if (exp)  exp.addEventListener('click',  function () { _setAllNodes(true);  });
        if (coll) coll.addEventListener('click', function () { _setAllNodes(false); });
    }

    /* ── Public: load tree for a scan ─────────────────────────────────── */
    function load(scanId) {
        API.getTree(scanId)
            .then(function (resp) {
                var root = (resp && resp.path) ? resp : (resp && resp.root ? resp.root : resp);
                if (!root || !root.path) throw new Error('No tree data');
                var normalised = _normaliseNode(root);
                Store.set('currentTreeData', normalised);
                _renderMainTree(normalised);
            })
            .catch(function (err) {
                var el = document.getElementById('directoryTree');
                if (el) el.innerHTML =
                    '<div class="empty-state"><i class="fas fa-triangle-exclamation"></i><p>Failed to load tree</p></div>';
                console.error('Tree load error:', err);
            });
    }

    /* ── Normalise API response to a flat, uniform shape ──────────────── */
    function _normaliseNode(n) {
        if (!n || !n.path) return null;
        var name = n.path.replace(/\\/g, '/').split('/').pop() || n.path;
        var children = [];
        (n.subdirs || []).forEach(function (s) {
            var c = _normaliseNode(s);
            if (c) children.push(c);
        });
        (n.files || []).forEach(function (f) {
            children.push({
                type: 'file',
                name: f.path.replace(/\\/g, '/').split('/').pop(),
                path: f.path,
                size: (f.metadata && f.metadata.size) || 0
            });
        });
        return { type: 'directory', name: name, path: n.path, size: (n.metadata && n.metadata.size) || 0, children: children };
    }

    /* ── Main tree (no checkboxes) ─────────────────────────────────────── */
    function _renderMainTree(tree) {
        var el = document.getElementById('directoryTree');
        if (!el) return;
        if (!tree) { el.innerHTML = '<div class="empty-state"><p>Empty directory</p></div>'; return; }
        el.innerHTML = _buildMainNode(tree, 0, true);
        _wireMainTreeToggles(el);
    }

    function _buildMainNode(node, depth, isRoot) {
        if (!node) return '';
        var id    = 'mn' + Math.random().toString(36).slice(2, 9);
        var hasCh = Array.isArray(node.children) && node.children.length > 0;
        var open  = isRoot === true;

        var html =
            '<div class="tree-node"' +
            ' data-path="' + _esc(node.path) + '"' +
            ' data-type="' + node.type + '"' +
            ' data-size="' + (node.size || 0) + '">';

        html += '<div class="tree-node-content" style="padding-left:' + (depth * 18) + 'px">';

        if (hasCh) {
            html += '<i class="fas ' + (open ? 'fa-chevron-down' : 'fa-chevron-right') +
                    ' tree-toggle" data-node-id="' + id + '"></i>';
        } else {
            html += '<span class="tree-spacer"></span>';
        }

        var iconCls = node.type === 'directory'
            ? 'fa-folder folder-icon'
            : Utils.getFileIcon(_ext(node.name)) + ' file-icon';

        html += '<i class="fas ' + iconCls + ' tree-icon"></i>';
        html += '<span class="tree-label">' + _esc(node.name) + '</span>';
        if (node.size) html += '<span class="tree-size">' + Utils.formatBytes(node.size) + '</span>';
        html += '</div>';

        if (hasCh) {
            html += '<div class="tree-children" data-parent="' + id + '"' + (open ? '' : ' style="display:none"') + '>';
            node.children.forEach(function (c) { html += _buildMainNode(c, depth + 1, false); });
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    function _wireMainTreeToggles(container) {
        container.querySelectorAll('.tree-toggle').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                _toggleNode(btn, container);
            });
        });
        container.querySelectorAll('.tree-node-content').forEach(function (content) {
            content.addEventListener('click', function () { _onNodeClick(content); });
        });
    }

    function _toggleNode(btn, container) {
        var ch   = (container || document.getElementById('directoryTree'))
                        .querySelector('.tree-children[data-parent="' + btn.dataset.nodeId + '"]');
        if (!ch) return;
        var open = btn.classList.contains('fa-chevron-down');
        ch.style.display = open ? 'none' : 'block';
        btn.classList.toggle('fa-chevron-down',  !open);
        btn.classList.toggle('fa-chevron-right',  open);
    }

    /* ── Preview panel ─────────────────────────────────────────────────── */
    function _onNodeClick(contentEl) {
        document.querySelectorAll('#directoryTree .tree-node-content.selected')
            .forEach(function (n) { n.classList.remove('selected'); });
        contentEl.classList.add('selected');

        var node = contentEl.closest('.tree-node');
        _showPreview({
            path: node.dataset.path || '',
            type: node.dataset.type || 'file',
            size: parseInt(node.dataset.size || '0', 10)
        });
    }

    function _showPreview(item) {
        var emptyEl   = document.getElementById('previewEmpty');
        var contentEl = document.getElementById('previewContent');
        var heroEl    = document.getElementById('previewHero');
        var nameEl    = document.getElementById('previewName');
        var rowsEl    = document.getElementById('previewRows');
        if (!contentEl) return;

        if (emptyEl) emptyEl.style.display = 'none';
        contentEl.style.display = 'flex';

        var filename = item.path.replace(/\\/g, '/').split('/').pop() || item.path;
        var fileExt  = _ext(filename);
        var category = _fileCat(fileExt, item.type);

        if (heroEl) {
            var iconCls = 'picon-' + category;
            var iconFA  = item.type === 'directory' ? 'fa-folder' : Utils.getFileIcon(fileExt);
            heroEl.innerHTML = '<div class="preview-big-icon ' + iconCls + '"><i class="fas ' + iconFA + '"></i></div>';
        }

        if (nameEl) nameEl.textContent = filename;

        if (rowsEl) {
            var meta = [
                { icon: 'fa-tag',          key: 'Name',      val: filename },
                { icon: 'fa-route',        key: 'Path',      val: item.path },
                { icon: 'fa-layer-group',  key: 'Type',      val: item.type === 'directory' ? 'Directory' : (fileExt ? fileExt.toUpperCase() + ' File' : 'File') },
                { icon: 'fa-puzzle-piece', key: 'Category',  val: _cat2label(category) },
                { icon: 'fa-weight-scale', key: 'Size',      val: item.size ? Utils.formatBytes(item.size) : '—' }
            ];
            if (fileExt && item.type !== 'directory') {
                meta.splice(2, 0, { icon: 'fa-file-signature', key: 'Extension', val: '.' + fileExt });
            }
            rowsEl.innerHTML = meta.map(function (r) {
                return '<div class="preview-row">' +
                    '<div class="preview-row-icon"><i class="fas ' + r.icon + '"></i></div>' +
                    '<div><div class="preview-row-key">' + r.key + '</div>' +
                    '<div class="preview-row-val">' + _esc(String(r.val)) + '</div></div></div>';
            }).join('');
        }
    }

    /* ── Expand / Collapse all ─────────────────────────────────────────── */
    function _setAllNodes(expand) {
        var tree = document.getElementById('directoryTree');
        if (!tree) return;
        tree.querySelectorAll('.tree-toggle').forEach(function (btn) {
            var ch = tree.querySelector('.tree-children[data-parent="' + btn.dataset.nodeId + '"]');
            if (!ch) return;
            ch.style.display = expand ? 'block' : 'none';
            btn.classList.toggle('fa-chevron-down',  expand);
            btn.classList.toggle('fa-chevron-right', !expand);
        });
    }

    /* ── Modal tree builder (WITH checkboxes, used by TransformPage) ───── */
    function buildModalTree(tree, containerId, treeType) {
        var el = document.getElementById(containerId);
        if (!el) return;
        if (!tree) { el.innerHTML = '<div class="empty-state"><p>No scan loaded</p></div>'; return; }
        el.innerHTML = _buildModalNode(tree, 0, true, treeType);

        el.querySelectorAll('.tree-toggle').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var ch = el.querySelector('.tree-children[data-parent="' + btn.dataset.nodeId + '"]');
                if (!ch) return;
                var open = btn.classList.contains('fa-chevron-down');
                ch.style.display = open ? 'none' : 'block';
                btn.classList.toggle('fa-chevron-down',  !open);
                btn.classList.toggle('fa-chevron-right',  open);
            });
        });

        el.querySelectorAll('.tree-checkbox').forEach(function (cb) {
            cb.addEventListener('change', function () { _handleFileSelection(cb, treeType); });
        });
    }

    function _buildModalNode(node, depth, isRoot, treeType) {
        if (!node) return '';
        var id    = 'mod' + Math.random().toString(36).slice(2, 9);
        var hasCh = Array.isArray(node.children) && node.children.length > 0;
        var open  = isRoot === true;

        var html = '<div class="tree-node"><div class="tree-node-content" style="padding-left:' + (depth * 14) + 'px">';

        if (hasCh) {
            html += '<i class="fas ' + (open ? 'fa-chevron-down' : 'fa-chevron-right') +
                    ' tree-toggle" data-node-id="' + id + '"></i>';
        } else {
            html += '<span class="tree-spacer"></span>';
        }

        if (node.type === 'file') {
            html += '<input type="checkbox" class="tree-checkbox"' +
                    ' data-file-path="' + _esc(node.path) + '"' +
                    ' data-tree-type="' + treeType + '">';
            html += '<i class="fas ' + Utils.getFileIcon(_ext(node.name)) + ' tree-icon file-icon"></i>';
        } else {
            html += '<i class="fas fa-folder tree-icon folder-icon"></i>';
        }

        html += '<span class="tree-label">' + _esc(node.name) + '</span>';
        if (node.size) html += '<span class="tree-size">' + Utils.formatBytes(node.size) + '</span>';
        html += '</div>';

        if (hasCh) {
            html += '<div class="tree-children" data-parent="' + id + '"' + (open ? '' : ' style="display:none"') + '>';
            node.children.forEach(function (c) { html += _buildModalNode(c, depth + 1, false, treeType); });
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    function _handleFileSelection(cb, treeType) {
        var p = cb.getAttribute('data-file-path');
        var mf = Store.get('modalFiles');
        if (!mf[treeType]) mf[treeType] = [];
        if (cb.checked) {
            if (mf[treeType].indexOf(p) === -1) mf[treeType].push(p);
        } else {
            mf[treeType] = mf[treeType].filter(function (x) { return x !== p; });
        }
        Store.merge('modalFiles', mf);
        var countEl = document.getElementById(treeType + 'FileCount');
        if (countEl) countEl.textContent = mf[treeType].length;
    }

    /* ── Category helpers ──────────────────────────────────────────────── */
    function _fileCat(e, type) {
        if (type === 'directory') return 'folder';
        e = (e || '').toLowerCase();
        if (['jpg','jpeg','png','gif','bmp','svg','webp','ico','tiff','tif','avif'].indexOf(e) !== -1) return 'image';
        if (['mp4','avi','mkv','mov','wmv','flv','webm','m4v'].indexOf(e) !== -1) return 'video';
        if (['mp3','wav','flac','aac','ogg','wma','m4a'].indexOf(e) !== -1) return 'audio';
        if (['js','ts','jsx','tsx','py','java','cpp','c','h','cs','php','rb','go',
             'rs','swift','kt','html','css','json','xml','sh','sql'].indexOf(e) !== -1) return 'code';
        if (['pdf','doc','docx','txt','rtf','md','epub'].indexOf(e) !== -1) return 'doc';
        if (['zip','rar','7z','tar','gz','bz2','xz'].indexOf(e) !== -1) return 'archive';
        return 'file';
    }

    function _cat2label(c) {
        return { folder:'Directory',image:'Image',video:'Video',audio:'Audio',
                 code:'Source Code',doc:'Document',archive:'Archive',file:'File' }[c] || 'File';
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
        init          : init,
        load          : load,
        buildModalTree: buildModalTree
    };
})();
