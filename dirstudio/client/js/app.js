/**
 * DirStudio — app.js
 *
 * Requires: utils.js (Utils), api.js (API), bootstrap 5, chart.js 4
 *
 * Features:
 *  - Upload zone: drag-and-drop visual, folder picker (webkitdirectory), typed path prompt
 *  - Overview: stat cards, file-type pie, top-5 extensions, storage doughnut, scan info card
 *  - Tree tab: NO checkboxes, click-to-preview panel (name/path/type/size/category)
 *  - Transform modals: trees WITH checkboxes (unchanged behaviour)
 *  - Duplicates, AI suggestions, transforms
 */

(function () {
    'use strict';

    /* ── Chart palette ────────────────────────────────────────────────── */
    var COLORS = [
        '#3b82f6','#06b6d4','#22c55e','#f59e0b',
        '#8b5cf6','#ef4444','#0ea5e9','#84cc16',
        '#ec4899','#14b8a6'
    ];

    /* ── State ────────────────────────────────────────────────────────── */
    var ws              = null;
    var pollTimer       = null;
    var currentTreeData = null;
    var pieChart        = null;
    var storageChart    = null;
    var modalFiles      = {};   // { compress:[], convert:[], resize:[] }
    var currentScanMeta = null;

    /* ══════════════════════════════════════════════════════════════════
       BOOT — called after components.js has injected all HTML
    ══════════════════════════════════════════════════════════════════ */
    function init() {
        Utils.setTheme(Utils.getPreferredTheme());

        var themeBtn = document.getElementById('themeToggleBtn');
        if (themeBtn) themeBtn.addEventListener('click', Utils.toggleTheme);

        initUploadZone();
        initTreeToolbar();
        loadScans();

        var saved = API.getCurrentScan();
        if (saved) loadScan(saved);
    }

    /* ══════════════════════════════════════════════════════════════════
       UPLOAD ZONE
       Three entry points in sidebar.html:
         1. Drag-drop onto zone  → prompt (browser can't expose real FS path)
         2. "Browse" button      → hidden <input webkitdirectory> → prompt
         3. "Enter path" button  → prompt
       Bare click on zone body  → prompt
    ══════════════════════════════════════════════════════════════════ */
    function initUploadZone() {
        /* Components load asynchronously — poll until the zone is in DOM */
        var attempts = 0;
        var t = setInterval(function () {
            var zone = document.getElementById('uploadZone');
            if (!zone) { if (++attempts > 50) clearInterval(t); return; }
            clearInterval(t);
            wireZone(zone);
        }, 100);
    }

    function wireZone(zone) {
        var folderBtn   = document.getElementById('folderPickerBtn');
        var pathBtn     = document.getElementById('pathPromptBtn');
        var folderInput = document.getElementById('folderInput');

        /* Drag events */
        ['dragenter','dragover','dragleave','drop'].forEach(function (ev) {
            zone.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); });
        });
        zone.addEventListener('dragenter', function () { zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', function (e) {
            if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
        });
        zone.addEventListener('drop', function () {
            zone.classList.remove('drag-over');
            promptForPath();
        });

        /* Bare zone click → prompt */
        zone.addEventListener('click', function (e) {
            if (e.target.closest('.upload-btn')) return;
            promptForPath();
        });

        /* Folder picker */
        if (folderBtn && folderInput) {
            folderBtn.addEventListener('click', function (e) {
                e.stopPropagation(); folderInput.click();
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

        /* Typed path button */
        if (pathBtn) {
            pathBtn.addEventListener('click', function (e) {
                e.stopPropagation(); promptForPath();
            });
        }
    }

    function promptForPath() {
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

    function startScan(path) {
        localStorage.setItem('lastScanPath', path);
        Utils.showToast('Starting scan: ' + path, 'info');
        API.createScan(path)
            .then(function (res) {
                Utils.showToast('Scan started!', 'success');
                loadScans();
                setTimeout(function () { loadScan(res.scan_id); }, 800);
            })
            .catch(function (err) { Utils.showToast('Scan failed: ' + err.message, 'error'); });
    }

    /* ══════════════════════════════════════════════════════════════════
       SCAN HISTORY
    ══════════════════════════════════════════════════════════════════ */
    function loadScans() {
        API.getAllScans()
            .then(function (scans) {
                scans.sort(function (a,b) {
                    return new Date(b.created_at||0) - new Date(a.created_at||0);
                });
                renderScanHistory(scans);
            })
            .catch(function (err) { Utils.showToast('Could not load scans: ' + err.message, 'error'); });
    }

    function renderScanHistory(scans) {
        var el = document.getElementById('scanHistoryList');
        if (!el) return;
        if (!scans.length) {
            el.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>No scans yet</p></div>';
            return;
        }
        var html = '';
        scans.forEach(function (s) {
            var cls = {completed:'success',running:'info',failed:'danger'}[s.status] || 'secondary';
            html += '<div class="scan-card" onclick="loadScanFromCard(event,\'' + s.scan_id + '\')" data-scan-id="' + s.scan_id + '">';
            html += '<div class="scan-name"><i class="fas fa-folder"></i>' + esc(pathName(s.path)) + '</div>';
            html += '<div class="scan-path" title="' + esc(s.path) + '">' + esc(s.path) + '</div>';
            html += '<div class="scan-meta"><span class="badge bg-' + cls + '">' + s.status + '</span></div>';
            html += '</div>';
        });
        el.innerHTML = html;
    }

    window.loadScanFromCard = function (e, id) {
        e.stopPropagation();
        showTab('overview');
        loadScan(id);
    };

    function showTab(id) {
        var btn = document.querySelector('[data-bs-target="#' + id + '"]');
        if (btn) new bootstrap.Tab(btn).show();
    }

    function pathName(path) {
        if (!path) return 'Unknown';
        var p = path.replace(/\\/g,'/').split('/');
        return p[p.length-1] || p[p.length-2] || 'Root';
    }

    /* ══════════════════════════════════════════════════════════════════
       LOAD / POLL SCAN
    ══════════════════════════════════════════════════════════════════ */
    function loadScan(scanId) {
        API.setCurrentScan(scanId);
        document.querySelectorAll('.scan-card').forEach(function (c) {
            c.classList.toggle('active', c.dataset.scanId === scanId);
        });
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }

        API.getScan(scanId)
            .then(function (scan) {
                currentScanMeta = scan;
                if (scan.status === 'completed') {
                    loadScanData(scanId);
                } else if (scan.status === 'running' || scan.status === 'pending') {
                    Utils.showToast('Scan is ' + scan.status + '…', 'info');
                    pollScan(scanId);
                } else if (scan.status === 'failed') {
                    Utils.showToast('Scan failed: ' + (scan.error || 'unknown error'), 'error');
                }
            })
            .catch(function (err) { Utils.showToast('Load error: ' + err.message, 'error'); });
    }

    function pollScan(scanId) {
        pollTimer = setInterval(function () {
            API.getScan(scanId).then(function (scan) {
                if (scan.status === 'completed') {
                    clearInterval(pollTimer); pollTimer = null;
                    Utils.showToast('Scan complete!', 'success');
                    currentScanMeta = scan;
                    loadScanData(scanId);
                    loadScans();
                } else if (scan.status === 'failed') {
                    clearInterval(pollTimer); pollTimer = null;
                    Utils.showToast('Scan failed: ' + (scan.error || 'unknown'), 'error');
                }
            }).catch(console.error);
        }, 2000);
    }

    function loadScanData(scanId) {
        loadOverview(scanId);
        loadTree(scanId);
        loadDuplicates(scanId);
    }

    /* ══════════════════════════════════════════════════════════════════
       OVERVIEW
    ══════════════════════════════════════════════════════════════════ */
    function loadOverview(scanId) {
        API.getScanOverview(scanId)
            .then(function (data) {
                setStat('totalFiles', Utils.formatNumber(data.total_files || 0));
                setStat('totalSize',  Utils.formatBytes(data.total_size  || 0));
                setStat('totalDirs',  Utils.formatNumber(data.total_dirs || 0));

                var groups = groupExtensions(data.top_extensions || []);
                renderPieChart(groups);
                renderTopExtensions(data.top_extensions || [], data.total_files || 0);
                renderStorageDoughnut(groups, data.total_size || 0);
                renderScanInfoCard(data);
            })
            .catch(function (err) { Utils.showToast('Overview error: ' + err.message, 'error'); });
    }

    function setStat(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function groupExtensions(exts) {
        var MAP = {
            Images:        ['jpg','jpeg','png','gif','bmp','svg','webp','ico','tiff','tif','avif','heic'],
            Videos:        ['mp4','avi','mkv','mov','wmv','flv','webm','m4v','3gp'],
            Audio:         ['mp3','wav','flac','aac','ogg','wma','m4a','opus'],
            Documents:     ['pdf','doc','docx','txt','rtf','odt','md','srt','epub'],
            Spreadsheets:  ['xls','xlsx','csv','ods','tsv'],
            Presentations: ['ppt','pptx','odp','key'],
            Code:          ['js','ts','jsx','tsx','py','java','cpp','c','h','cs','php','rb','go',
                            'rs','swift','kt','html','css','scss','json','yaml','yml','xml','sh','sql','vue'],
            Archives:      ['zip','rar','7z','tar','gz','bz2','xz','dmg'],
            Executables:   ['exe','msi','app','deb','rpm','dll','so'],
            Other:         []
        };
        var counts = {};
        Object.keys(MAP).forEach(function (k) { counts[k] = 0; });
        exts.forEach(function (e) {
            var name  = (e.ext||e.extension||'').toLowerCase().replace(/^\./,'');
            var count = e.count||e.file_count||0;
            var hit   = false;
            for (var k in MAP) {
                if (MAP[k].indexOf(name) !== -1) { counts[k] += count; hit = true; break; }
            }
            if (!hit) counts.Other += count;
        });
        return Object.keys(counts)
            .filter(function (k) { return counts[k] > 0; })
            .map(function (k)    { return { name:k, count:counts[k] }; })
            .sort(function (a,b) { return b.count - a.count; });
    }

    /* File-type doughnut pie */
    function renderPieChart(groups) {
        var canvas = document.getElementById('fileTypeChart');
        if (!canvas) return;
        if (pieChart) { pieChart.destroy(); pieChart = null; }
        if (!groups.length) { canvas.style.display='none'; return; }
        canvas.style.display = 'block';

        var dark       = document.documentElement.dataset.theme === 'dark';
        var textColor  = dark ? '#7e99b8' : '#4a586e';
        var borderClr  = dark ? '#131d2e' : '#ffffff';

        pieChart = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: groups.map(function (g) { return g.name; }),
                datasets: [{
                    data: groups.map(function (g) { return g.count; }),
                    backgroundColor: COLORS.slice(0, groups.length),
                    borderWidth: 3, borderColor: borderClr, hoverOffset: 6
                }]
            },
            options: {
                responsive:true, maintainAspectRatio:true, cutout:'60%',
                plugins: {
                    legend: {
                        position:'right',
                        labels:{ padding:14, font:{size:12,family:'DM Sans',weight:'600'},
                                 color:textColor, usePointStyle:true, pointStyle:'circle' }
                    },
                    tooltip: {
                        backgroundColor: dark?'#192436':'#0d1829',
                        padding:12, cornerRadius:10,
                        titleFont:{size:13,weight:'700',family:'DM Sans'},
                        bodyFont:{size:12,family:'DM Sans'},
                        callbacks:{
                            label:function(ctx){
                                var val=ctx.parsed||0;
                                var tot=ctx.dataset.data.reduce(function(a,b){return a+b;},0);
                                return ' '+ctx.label+': '+Utils.formatNumber(val)+' ('+((val/tot)*100).toFixed(1)+'%)';
                            }
                        }
                    }
                }
            }
        });
    }

    /* Top 5 raw extensions */
    function renderTopExtensions(exts, totalFiles) {
        var el = document.getElementById('extensionsList');
        if (!el) return;
        if (!exts.length) { el.innerHTML='<div class="empty-state"><p>No data</p></div>'; return; }
        var top5     = exts.slice(0,5);
        var maxCount = (top5[0] && (top5[0].count||top5[0].file_count)) || 1;
        var html = '';
        top5.forEach(function (e, i) {
            var name  = (e.ext||e.extension||'').replace(/^\./,'') || '?';
            var count = e.count||e.file_count||0;
            var pct   = totalFiles > 0 ? ((count/totalFiles)*100).toFixed(1) : '0';
            var barW  = maxCount  > 0 ? ((count/maxCount)*100).toFixed(1) : '0';
            var color = COLORS[i]||COLORS[0];
            html += '<div class="ext-item">' +
                '<span class="ext-rank">'+(i+1)+'</span>' +
                '<i class="fas '+Utils.getFileIcon(name)+' ext-icon-fa" style="color:'+color+'"></i>' +
                '<div class="ext-body">' +
                '<div class="ext-top">' +
                '<span class="ext-name">.' + esc(name) + '</span>' +
                '<span><span class="ext-count">'+Utils.formatNumber(count)+'</span>' +
                '<span class="ext-pct">'+pct+'%</span></span>' +
                '</div>' +
                '<div class="ext-bar-bg"><div class="ext-bar-fg" style="width:'+barW+'%;background:'+color+'"></div></div>' +
                '</div></div>';
        });
        el.innerHTML = html;
    }

    /* Storage doughnut (GNOME disk-usage style) */
    function renderStorageDoughnut(groups, totalSize) {
        var canvas   = document.getElementById('storageChart');
        var legendEl = document.getElementById('storageLegend');
        var centerEl = document.getElementById('storageCenterValue');
        if (!canvas) return;
        if (storageChart) { storageChart.destroy(); storageChart = null; }
        if (!groups.length) return;

        if (centerEl) centerEl.textContent = Utils.formatBytes(totalSize);

        var dark      = document.documentElement.dataset.theme === 'dark';
        var borderClr = dark ? '#0b1120' : '#eef2f7';

        storageChart = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: groups.map(function(g){return g.name;}),
                datasets:[{
                    data: groups.map(function(g){return g.count;}),
                    backgroundColor: COLORS.slice(0,groups.length),
                    borderWidth:4, borderColor:borderClr, hoverOffset:8
                }]
            },
            options: {
                responsive:true, maintainAspectRatio:true, cutout:'72%',
                plugins:{
                    legend:{display:false},
                    tooltip:{
                        backgroundColor: dark?'#192436':'#0d1829',
                        padding:11, cornerRadius:10,
                        titleFont:{size:12,weight:'700',family:'DM Sans'},
                        bodyFont:{size:12,family:'DM Sans'},
                        callbacks:{
                            label:function(ctx){
                                var val=ctx.parsed||0;
                                var tot=ctx.dataset.data.reduce(function(a,b){return a+b;},0);
                                return ' '+ctx.label+': '+Utils.formatNumber(val)+' files ('+((val/tot)*100).toFixed(1)+'%)';
                            }
                        }
                    }
                }
            }
        });

        if (legendEl) {
            var total = groups.reduce(function(s,g){return s+g.count;},0);
            legendEl.innerHTML = groups.slice(0,7).map(function(g,i){
                var pct = total>0 ? ((g.count/total)*100).toFixed(1) : '0';
                return '<div class="storage-legend-row">' +
                    '<span class="storage-dot" style="background:'+COLORS[i]+'"></span>' +
                    '<span class="storage-name">'+esc(g.name)+'</span>' +
                    '<span class="storage-pct">'+pct+'%</span>' +
                    '</div>';
            }).join('');
        }
    }

    /* Scan info card */
    function renderScanInfoCard(data) {
        var el = document.getElementById('scanInfoCard');
        if (!el) return;

        var s = currentScanMeta || {};

        var rows = [
            {
                icon:'fa-folder',
                key:'Folder',
                val:pathName(s.path || data.path || ''),
                plain:true
            },
            {
                icon:'fa-route',
                key:'Full Path',
                val:s.path || data.path || '—'
            },
            {
                icon:'fa-calendar-plus',
                key:'Scanned',
                val:s.created_at ? fmtDate(s.created_at) : '—',
                plain:true
            },
            {
                icon:'fa-circle-check',
                key:'Status',
                val:s.status || 'completed',
                plain:true
            }
        ];

        el.innerHTML = rows.map(function(r){
            return '<div class="info-row">' +
                '<div class="info-row-icon"><i class="fas '+r.icon+'"></i></div>' +
                '<div>' +
                    '<div class="info-row-key">'+r.key+'</div>' +
                    '<div class="info-row-val'+(r.plain?' plain':'')+'">' + esc(String(r.val)) + '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    function fmtDate(iso) {
        try {
            var d = new Date(iso);
            return d.toLocaleDateString()+' · '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
        } catch(e) { return String(iso); }
    }

    /* ══════════════════════════════════════════════════════════════════
       TREE TAB — no checkboxes, click → preview
    ══════════════════════════════════════════════════════════════════ */
    function initTreeToolbar() {
        var t = setInterval(function () {
            var exp = document.getElementById('treeExpandAll');
            if (!exp) return;
            clearInterval(t);
            exp.addEventListener('click', function () { setAllNodes(true); });
            document.getElementById('treeCollapseAll').addEventListener('click', function () { setAllNodes(false); });
        }, 100);
    }

    function setAllNodes(expand) {
        var tree = document.getElementById('directoryTree');
        if (!tree) return;
        tree.querySelectorAll('.tree-toggle').forEach(function (btn) {
            var ch = tree.querySelector('.tree-children[data-parent="'+btn.dataset.nodeId+'"]');
            if (!ch) return;
            ch.style.display = expand ? 'block' : 'none';
            btn.classList.toggle('expanded',        expand);
            btn.classList.toggle('fa-chevron-down',  expand);
            btn.classList.toggle('fa-chevron-right', !expand);
        });
    }

    function loadTree(scanId) {
        API.getTree(scanId)
            .then(function (resp) {
                var root = (resp && resp.path) ? resp : (resp && resp.root ? resp.root : resp);
                if (!root || !root.path) throw new Error('No tree data');
                currentTreeData = fsNode(root);
                renderMainTree(currentTreeData);
            })
            .catch(function (err) {
                var el = document.getElementById('directoryTree');
                if (el) el.innerHTML = '<div class="empty-state"><i class="fas fa-triangle-exclamation"></i><p>Failed to load tree</p></div>';
                console.error(err);
            });
    }

    function fsNode(n) {
        if (!n || !n.path) return null;
        var name = n.path.replace(/\\/g,'/').split('/').pop() || n.path;
        var children = [];
        (n.subdirs||[]).forEach(function(s){var c=fsNode(s);if(c)children.push(c);});
        (n.files||[]).forEach(function(f){
            children.push({
                type:'file', name:f.path.replace(/\\/g,'/').split('/').pop(),
                path:f.path, size:(f.metadata&&f.metadata.size)||0
            });
        });
        return {type:'directory',name:name,path:n.path,size:(n.metadata&&n.metadata.size)||0,children:children};
    }

    function renderMainTree(tree) {
        var el = document.getElementById('directoryTree');
        if (!el) return;
        if (!tree) { el.innerHTML='<div class="empty-state"><p>Empty</p></div>'; return; }
        el.innerHTML = buildMainNode(tree, 0, true);
    }

    function buildMainNode(node, depth, isRoot) {
        if (!node) return '';
        var id    = 'mn'+Math.random().toString(36).slice(2,9);
        var hasCh = Array.isArray(node.children)&&node.children.length>0;
        var open  = isRoot===true;

        var html = '<div class="tree-node"' +
            ' data-path="'  + esc(node.path) + '"' +
            ' data-type="'  + node.type + '"' +
            ' data-size="'  + (node.size||0) + '">';

        html += '<div class="tree-node-content" style="padding-left:'+(depth*18)+'px" onclick="treeNodeClick(this)">';

        if (hasCh) {
            html += '<i class="fas '+(open?'fa-chevron-down expanded':'fa-chevron-right')+
                    ' tree-toggle" data-node-id="'+id+'" onclick="event.stopPropagation();toggleNode(this)"></i>';
        } else {
            html += '<span class="tree-spacer"></span>';
        }

        var iconCls = node.type==='directory'
            ? 'fa-folder folder-icon'
            : Utils.getFileIcon(ext(node.name))+' file-icon';

        html += '<i class="fas '+iconCls+' tree-icon"></i>';
        html += '<span class="tree-label">'+esc(node.name)+'</span>';
        if (node.size) html += '<span class="tree-size">'+Utils.formatBytes(node.size)+'</span>';
        html += '</div>';

        if (hasCh) {
            html += '<div class="tree-children" data-parent="'+id+'"'+(open?'':' style="display:none"')+'>';
            node.children.forEach(function(c){html+=buildMainNode(c,depth+1,false);});
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    window.toggleNode = function (btn) {
        var tree = document.getElementById('directoryTree');
        var ch   = tree&&tree.querySelector('.tree-children[data-parent="'+btn.dataset.nodeId+'"]');
        if (!ch) return;
        var open = btn.classList.contains('expanded');
        ch.style.display = open ? 'none' : 'block';
        btn.classList.toggle('expanded',        !open);
        btn.classList.toggle('fa-chevron-down',  !open);
        btn.classList.toggle('fa-chevron-right',  open);
    };

    window.treeNodeClick = function (el) {
        document.querySelectorAll('#directoryTree .tree-node-content.selected')
            .forEach(function(n){n.classList.remove('selected');});
        el.classList.add('selected');
        var node = el.closest('.tree-node');
        showPreview({
            path: node.dataset.path || '',
            type: node.dataset.type || 'file',
            size: parseInt(node.dataset.size||'0',10)
        });
    };

    function showPreview(item) {
        var empty   = document.getElementById('previewEmpty');
        var content = document.getElementById('previewContent');
        var hero    = document.getElementById('previewHero');
        var nameEl  = document.getElementById('previewName');
        var rowsEl  = document.getElementById('previewRows');
        if (!content) return;

        if (empty)  empty.style.display  = 'none';
        content.style.display = 'flex';

        var filename = item.path.replace(/\\/g,'/').split('/').pop() || item.path;
        var fileExt  = ext(filename);
        var category = fileCat(fileExt, item.type);

        if (hero) {
            var iconCls = 'picon-' + category;
            var iconFA  = item.type==='directory' ? 'fa-folder' : Utils.getFileIcon(fileExt);
            hero.innerHTML = '<div class="preview-big-icon '+iconCls+'"><i class="fas '+iconFA+'"></i></div>';
        }
        if (nameEl) nameEl.textContent = filename;

        if (rowsEl) {
            var meta = [
                {icon:'fa-tag',          key:'Name',      val:filename},
                {icon:'fa-route',        key:'Path',      val:item.path},
                {icon:'fa-layer-group',  key:'Type',      val:item.type==='directory'?'Directory':(fileExt?fileExt.toUpperCase()+' File':'File')},
                {icon:'fa-puzzle-piece', key:'Category',  val:cat2label(category)},
                {icon:'fa-weight-scale', key:'Size',      val:item.size?Utils.formatBytes(item.size):'—'}
            ];
            if (fileExt && item.type!=='directory') {
                meta.splice(2,0,{icon:'fa-file-signature',key:'Extension',val:'.'+fileExt});
            }
            rowsEl.innerHTML = meta.map(function(r){
                return '<div class="preview-row">' +
                    '<div class="preview-row-icon"><i class="fas '+r.icon+'"></i></div>' +
                    '<div><div class="preview-row-key">'+r.key+'</div>' +
                    '<div class="preview-row-val">'+esc(String(r.val))+'</div></div></div>';
            }).join('');
        }
    }

    function fileCat(e, type) {
        if (type==='directory') return 'folder';
        e = (e||'').toLowerCase();
        if (['jpg','jpeg','png','gif','bmp','svg','webp','ico','tiff','tif','avif'].indexOf(e)!==-1) return 'image';
        if (['mp4','avi','mkv','mov','wmv','flv','webm','m4v'].indexOf(e)!==-1) return 'video';
        if (['mp3','wav','flac','aac','ogg','wma','m4a'].indexOf(e)!==-1) return 'audio';
        if (['js','ts','jsx','tsx','py','java','cpp','c','h','cs','php','rb','go','rs','swift',
             'kt','html','css','json','xml','sh','sql'].indexOf(e)!==-1) return 'code';
        if (['pdf','doc','docx','txt','rtf','md','epub'].indexOf(e)!==-1) return 'doc';
        if (['zip','rar','7z','tar','gz','bz2','xz'].indexOf(e)!==-1) return 'archive';
        return 'file';
    }
    function cat2label(c) {
        return {folder:'Directory',image:'Image',video:'Video',audio:'Audio',
                code:'Source Code',doc:'Document',archive:'Archive',file:'File'}[c]||'File';
    }

    /* ══════════════════════════════════════════════════════════════════
       MODAL TREES — WITH checkboxes (transform modals)
    ══════════════════════════════════════════════════════════════════ */
    function renderModalTree(tree, containerId, treeType) {
        var el = document.getElementById(containerId);
        if (!el) return;
        if (!tree) { el.innerHTML='<div class="empty-state"><p>No scan loaded</p></div>'; return; }
        el.innerHTML = buildModalNode(tree, 0, true, treeType);
        el.querySelectorAll('.tree-toggle').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var ch = el.querySelector('.tree-children[data-parent="'+btn.dataset.nodeId+'"]');
                if (!ch) return;
                var open = btn.classList.contains('expanded');
                ch.style.display = open?'none':'block';
                btn.classList.toggle('expanded',        !open);
                btn.classList.toggle('fa-chevron-down',  !open);
                btn.classList.toggle('fa-chevron-right',  open);
            });
        });
    }

    function buildModalNode(node, depth, isRoot, treeType) {
        if (!node) return '';
        var id    = 'mod'+Math.random().toString(36).slice(2,9);
        var hasCh = Array.isArray(node.children)&&node.children.length>0;
        var open  = isRoot===true;

        var html = '<div class="tree-node">';
        html += '<div class="tree-node-content" style="padding-left:'+(depth*14)+'px">';
        if (hasCh) {
            html += '<i class="fas '+(open?'fa-chevron-down expanded':'fa-chevron-right')+
                    ' tree-toggle" data-node-id="'+id+'"></i>';
        } else { html += '<span class="tree-spacer"></span>'; }

        if (node.type==='file') {
            html += '<input type="checkbox" class="tree-checkbox"' +
                    ' data-file-path="'+esc(node.path)+'"' +
                    ' data-tree-type="'+treeType+'"' +
                    ' onchange="handleFileSelection(this,\''+treeType+'\')">';
            html += '<i class="fas '+Utils.getFileIcon(ext(node.name))+' tree-icon file-icon"></i>';
        } else {
            html += '<i class="fas fa-folder tree-icon folder-icon"></i>';
        }
        html += '<span class="tree-label">'+esc(node.name)+'</span>';
        if (node.size) html += '<span class="tree-size">'+Utils.formatBytes(node.size)+'</span>';
        html += '</div>';

        if (hasCh) {
            html += '<div class="tree-children" data-parent="'+id+'"'+(open?'':' style="display:none"')+'>';
            node.children.forEach(function(c){html+=buildModalNode(c,depth+1,false,treeType);});
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    window.handleFileSelection = function (cb, treeType) {
        var p = cb.getAttribute('data-file-path');
        if (!modalFiles[treeType]) modalFiles[treeType] = [];
        if (cb.checked) { if (modalFiles[treeType].indexOf(p)===-1) modalFiles[treeType].push(p); }
        else { modalFiles[treeType] = modalFiles[treeType].filter(function(x){return x!==p;}); }
        var el = document.getElementById(treeType+'FileCount');
        if (el) el.textContent = modalFiles[treeType].length;
    };

    /* ══════════════════════════════════════════════════════════════════
       DUPLICATES
    ══════════════════════════════════════════════════════════════════ */
    function loadDuplicates(scanId) {
        API.getDuplicates(scanId, {detect_exact:true,detect_near:true})
            .then(renderDuplicates)
            .catch(function(e){console.error('Duplicates:',e);});
    }

    function renderDuplicates(data) {
        var el = document.getElementById('duplicateGroups');
        if (!el) return;
        var html = '';

        if (data.statistics) {
            var s = data.statistics;
            html += '<div class="analysis-section mb-4">';
            html += '<h5 class="mb-3"><i class="fas fa-chart-bar me-2"></i>Analysis</h5>';
            html += '<div class="row g-3">';
            [{icon:'fa-copy',label:'Exact Groups',val:s.exact_duplicate_groups||0},
             {icon:'fa-clone',label:'Near-Dup Groups',val:s.near_duplicate_groups||0},
             {icon:'fa-trash',label:'Wasted Space',val:Math.ceil((s.total_wastage_bytes||0)/1e6)+' MB'},
             {icon:'fa-piggy-bank',label:'Potential Savings',val:Math.ceil(s.potential_savings_mb||0)+' MB'}
            ].forEach(function(item){
                html += '<div class="col-md-3"><div class="stat-card">' +
                    '<div class="stat-icon stat-icon--files"><i class="fas '+item.icon+'"></i></div>' +
                    '<div class="stat-content"><div class="stat-label">'+item.label+'</div>' +
                    '<div class="stat-value" style="font-size:22px">'+item.val+'</div></div></div></div>';
            });
            html += '</div></div>';
        }

        var groups = Object.values(data.exact_duplicates||{}).concat(Object.values(data.near_duplicates||{}));
        if (!groups.length) {
            html += '<div class="empty-state"><i class="fas fa-check-circle"></i><p>No duplicates found!</p></div>';
        } else {
            html += '<h5 class="mb-3"><i class="fas fa-copy me-2"></i>Duplicate Groups</h5>';
            groups.forEach(function(g){
                var files = g.files||[];
                var cls   = g.duplicate_type==='exact'?'danger':'warning';
                html += '<div class="duplicate-group border-'+cls+'">';
                html += '<div class="duplicate-header"><strong><span class="badge bg-'+cls+'">'+g.duplicate_type+'</span> '+files.length+' files</strong>' +
                    '<span>Wastage: '+Utils.formatBytes(g.wastage||0)+'</span></div>';
                html += '<div class="duplicate-files">';
                files.forEach(function(f){
                    var p=f.path||f;
                    html += '<div class="duplicate-file">' +
                        '<input type="checkbox" class="form-check-input" data-file-path="'+esc(p)+'">' +
                        '<i class="fas '+Utils.getFileIcon(ext(p))+'"></i><span>'+esc(p)+'</span></div>';
                });
                html += '</div></div>';
            });
        }
        el.innerHTML = html;
    }

    window.selectAllDuplicates = function () {
        document.querySelectorAll('#duplicateGroups input[type="checkbox"]').forEach(function(cb){cb.checked=true;});
    };

    window.cleanDuplicates = function () {
        var scanId = API.getCurrentScan();
        if (!scanId) return Utils.showToast('No scan selected','error');
        var paths = Array.from(document.querySelectorAll('#duplicateGroups input[type="checkbox"]:checked'))
                         .map(function(cb){return cb.getAttribute('data-file-path');});
        if (!paths.length) return Utils.showToast('No files selected','error');
        if (!confirm('Delete '+paths.length+' file(s)?')) return;
        API.deleteFiles(scanId, paths, false).then(function(res){
            var ok = res.results.filter(function(r){return r.success;}).length;
            Utils.showToast('Deleted '+ok+'/'+paths.length,'success');
            loadDuplicates(scanId);
        });
    };

    /* ══════════════════════════════════════════════════════════════════
       AI SUGGESTIONS
    ══════════════════════════════════════════════════════════════════ */
    window.generateAISuggestions = function () {
        var scanId = API.getCurrentScan();
        if (!scanId) return Utils.showToast('No scan selected','error');
        var el = document.getElementById('aiSuggestionsContent');
        el.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Analysing with AI…</p></div>';
        API.getOrganizeSuggestions(scanId)
            .then(renderAISuggestions)
            .catch(function(e){
                el.innerHTML='<div class="alert alert-danger"><i class="fas fa-triangle-exclamation me-2"></i>'+esc(e.message)+'</div>';
            });
    };

    function renderAISuggestions(report) {
        var el   = document.getElementById('aiSuggestionsContent');
        if (!el) return;
        var sugg = report.suggestions||[];
        if (!sugg.length) {
            el.innerHTML='<div class="empty-state"><i class="fas fa-check-circle"></i><p>No suggestions — already well organised!</p></div>';
            return;
        }
        var html = '<div class="ai-suggestions-header">' +
            '<div class="ai-badge"><i class="fas fa-sparkles"></i>AI-Powered Analysis</div>' +
            '<div class="ai-stats"><span><i class="fas fa-lightbulb me-1"></i>'+sugg.length+' suggestions</span>' +
            '<span><i class="fas fa-file me-1"></i>'+report.statistics.total_files+' files</span></div></div>';

        sugg.forEach(function(s,i){
            var pct = Math.round(s.confidence*100);
            var cls = pct>=95?'success':pct>=85?'warning':'info';
            var sp  = s.target_path.split('/').slice(-2).join('/')||s.target_path;
            html += '<div class="suggestion-card">' +
                '<div class="suggestion-header">' +
                '<div class="suggestion-title"><span class="suggestion-number">'+(i+1)+'</span>' +
                '<i class="fas fa-folder-tree"></i><strong>'+esc(sp)+'</strong></div>' +
                '<span class="badge bg-'+cls+'">'+pct+'% confident</span></div>' +
                '<div class="suggestion-reason"><i class="fas fa-quote-left me-2"></i>'+esc(s.reason)+'</div>';

            if (s.file_count>0) {
                html += '<div class="suggestion-files"><div class="files-summary">' +
                    '<span><i class="fas fa-files me-2"></i><strong>'+s.file_count+' files</strong> to move</span>' +
                    '<button class="btn btn-sm btn-link" onclick="toggleSuggFiles('+i+',this)">' +
                    '<i class="fas fa-chevron-down"></i> Show</button></div>' +
                    '<div class="files-list" id="sf-'+i+'" style="display:none">';
                (s.files||[]).forEach(function(f){
                    html += '<div class="file-item"><i class="fas '+Utils.getFileIcon(ext(f))+' me-2"></i><span>'+esc(f)+'</span></div>';
                });
                html += '</div></div>';
            }
            html += '<div class="suggestion-actions">' +
                '<button class="btn btn-sm btn-outline-primary" onclick="copySuggPath(\''+esc(s.target_path)+'\')"><i class="fas fa-copy me-1"></i>Copy path</button>' +
                '</div></div>';
        });
        el.innerHTML = html;
    }

    window.toggleSuggFiles = function (i, btn) {
        var list = document.getElementById('sf-'+i);
        if (!list) return;
        var vis = list.style.display!=='none';
        list.style.display = vis?'none':'block';
        btn.innerHTML = '<i class="fas fa-chevron-'+(vis?'down':'up')+'"></i> '+(vis?'Show':'Hide');
    };
    window.copySuggPath = function (p) {
        if (navigator.clipboard) navigator.clipboard.writeText(p).then(function(){Utils.showToast('Copied!','success');});
        else Utils.showToast(p,'info');
    };

    /* ══════════════════════════════════════════════════════════════════
       TRANSFORM MODALS
    ══════════════════════════════════════════════════════════════════ */
    function openModal(id, treeId, treeType) {
        modalFiles[treeType] = [];
        renderModalTree(currentTreeData, treeId, treeType);
        var el = document.getElementById(treeType+'FileCount');
        if (el) el.textContent = '0';
        new bootstrap.Modal(document.getElementById(id)).show();
    }

    window.openCompressModal = function () { openModal('compressModal','compressTreeContainer','compress'); };
    window.openConvertModal  = function () { openModal('convertModal', 'convertTreeContainer', 'convert'); };
    window.openResizeModal   = function () { openModal('resizeModal',  'resizeTreeContainer',  'resize'); };

    window.executeCompress = function () {
        var files = modalFiles.compress||[];
        if (!files.length) return Utils.showToast('Select files first','error');
        var scanId = API.getCurrentScan(); if (!scanId) return Utils.showToast('No scan','error');
        var name   = document.getElementById('compressArchiveName').value||'archive.zip';
        var fmt    = document.getElementById('compressFormat').value;
        var outDir = document.getElementById('compressOutputDir').value||null;
        var dry    = document.getElementById('compressDryRun').checked;
        var target = outDir ? outDir+'/'+name : name;
        Utils.showToast('Compressing…','info');
        API.compressFiles(scanId, files, target, fmt, dry).then(function(res){
            bootstrap.Modal.getInstance(document.getElementById('compressModal')).hide();
            if (res.success) Utils.showToast('Compressed: '+res.target_path,'success');
            else Utils.showToast('Error: '+res.error,'error');
            showTransformResults([res]);
        });
    };

    window.executeConvert = function () {
        var files = modalFiles.convert||[];
        if (!files.length) return Utils.showToast('Select files first','error');
        var scanId = API.getCurrentScan(); if (!scanId) return Utils.showToast('No scan','error');
        var fmt = document.getElementById('convertFormat').value;
        var out = document.getElementById('convertOutputDir').value||null;
        var dry = document.getElementById('convertDryRun').checked;
        Utils.showToast('Converting…','info');
        API.convertImages(scanId,files,fmt,out,dry).then(function(res){
            bootstrap.Modal.getInstance(document.getElementById('convertModal')).hide();
            Utils.showToast('Converted '+res.results.filter(function(r){return r.success;}).length+' files','success');
            showTransformResults(res.results);
        });
    };

    window.executeResize = function () {
        var files = modalFiles.resize||[];
        if (!files.length) return Utils.showToast('Select files first','error');
        var scanId = API.getCurrentScan(); if (!scanId) return Utils.showToast('No scan','error');
        var w   = parseInt(document.getElementById('resizeMaxWidth').value)||1920;
        var h   = parseInt(document.getElementById('resizeMaxHeight').value)||1080;
        var out = document.getElementById('resizeOutputDir').value||null;
        var dry = document.getElementById('resizeDryRun').checked;
        Utils.showToast('Resizing…','info');
        API.resizeImages(scanId,files,w,h,out,dry).then(function(res){
            bootstrap.Modal.getInstance(document.getElementById('resizeModal')).hide();
            Utils.showToast('Resized '+res.results.filter(function(r){return r.success;}).length+' files','success');
            showTransformResults(res.results);
        });
    };

    function showTransformResults(results) {
        var wrap = document.getElementById('transformResults');
        var body = document.getElementById('transformResultsContent');
        if (!wrap||!body) return;
        var html = '<div class="table-responsive"><table class="table table-sm">' +
            '<thead><tr><th>Status</th><th>Source</th><th>Target</th><th>Error</th></tr></thead><tbody>';
        results.forEach(function(r){
            var icon = r.success
                ? '<i class="fas fa-check-circle text-success"></i>'
                : '<i class="fas fa-times-circle text-danger"></i>';
            html += '<tr><td>'+icon+'</td>' +
                '<td class="text-truncate" style="max-width:260px" title="'+esc(r.source_path||'')+'">'+esc(r.source_path||'')+'</td>' +
                '<td class="text-truncate" style="max-width:260px" title="'+esc(r.target_path||'-')+'">'+esc(r.target_path||'-')+'</td>' +
                '<td class="text-danger small">'+esc(r.error||'-')+'</td></tr>';
        });
        html += '</tbody></table></div>';
        body.innerHTML = html;
        wrap.style.display = 'block';
    }

    /* ── Tiny helpers ─────────────────────────────────────────────── */
    function ext(name) {
        if (!name) return '';
        var p = String(name).split('.');
        return p.length>1 ? p[p.length-1].toLowerCase() : '';
    }
    function esc(s) {
        return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    /* ── Entry point ──────────────────────────────────────────────── */
    window.onComponentsLoaded = init;

    window.addEventListener('beforeunload', function () {
        if (pollTimer) clearInterval(pollTimer);
        if (ws) ws.close();
    });
})();