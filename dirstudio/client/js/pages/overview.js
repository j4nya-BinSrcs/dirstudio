/**
 * DirStudio — pages/overview.js
 *
 * Controls the Overview tab:
 *   - Stat cards (total files, size, dirs)
 *   - File-category doughnut chart
 *   - Top-5 extensions bar list
 *   - Scan details info card
 *
 * Depends on: Utils, API, Store
 */

var OverviewPage = (function () {
    'use strict';

    /* ── Chart palette (shared with app) ──────────────────────────────── */
    var COLORS = [
        '#3b82f6','#06b6d4','#22c55e','#f59e0b',
        '#8b5cf6','#ef4444','#0ea5e9','#84cc16',
        '#ec4899','#14b8a6'
    ];

    /* ── Extension → category map ─────────────────────────────────────── */
    var CATEGORY_MAP = {
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

    /* ── Chart instance ────────────────────────────────────────────────── */
    var pieChart = null;

    /* ── Public: load data for a scan ─────────────────────────────────── */
    function load(scanId) {
        API.getScanOverview(scanId)
            .then(function (data) {
                _setStat('totalFiles', Utils.formatNumber(data.total_files || 0));
                _setStat('totalSize',  Utils.formatBytes(data.total_size  || 0));
                _setStat('totalDirs',  Utils.formatNumber(data.total_dirs  || 0));

                var groups = _groupExtensions(data.top_extensions || []);
                _renderPieChart(groups);
                _renderTopExtensions(data.top_extensions || [], data.total_files || 0);
                _renderScanInfoCard(data);
            })
            .catch(function (err) {
                Utils.showToast('Overview error: ' + err.message, 'error');
            });
    }

    /* ── Stat cards ────────────────────────────────────────────────────── */
    function _setStat(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    /* ── Extension grouping ────────────────────────────────────────────── */
    function _groupExtensions(exts) {
        var counts = {};
        Object.keys(CATEGORY_MAP).forEach(function (k) { counts[k] = 0; });

        exts.forEach(function (e) {
            var name  = (e.ext || e.extension || '').toLowerCase().replace(/^\./, '');
            var count = e.count || e.file_count || 0;
            var hit   = false;
            for (var k in CATEGORY_MAP) {
                if (CATEGORY_MAP[k].indexOf(name) !== -1) { counts[k] += count; hit = true; break; }
            }
            if (!hit) counts.Other += count;
        });

        return Object.keys(counts)
            .filter(function (k) { return counts[k] > 0; })
            .map(function (k)    { return { name: k, count: counts[k] }; })
            .sort(function (a, b) { return b.count - a.count; });
    }

    /* ── Pie chart ─────────────────────────────────────────────────────── */
    function _renderPieChart(groups) {
        var canvas = document.getElementById('fileTypeChart');
        if (!canvas) return;
        if (pieChart) { pieChart.destroy(); pieChart = null; }
        if (!groups.length) { canvas.style.display = 'none'; return; }
        canvas.style.display = 'block';

        var dark      = document.documentElement.dataset.theme === 'dark';
        var textColor = dark ? '#7e99b8' : '#4a586e';
        var borderClr = dark ? '#131d2e' : '#ffffff';

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
                responsive: true, maintainAspectRatio: true, cutout: '60%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            padding: 14,
                            font: { size: 12, family: 'DM Sans', weight: '600' },
                            color: textColor, usePointStyle: true, pointStyle: 'circle'
                        }
                    },
                    tooltip: {
                        backgroundColor: dark ? '#192436' : '#0d1829',
                        padding: 12, cornerRadius: 10,
                        titleFont: { size: 13, weight: '700', family: 'DM Sans' },
                        bodyFont:  { size: 12, family: 'DM Sans' },
                        callbacks: {
                            label: function (ctx) {
                                var val = ctx.parsed || 0;
                                var tot = ctx.dataset.data.reduce(function (a, b) { return a + b; }, 0);
                                return ' ' + ctx.label + ': ' + Utils.formatNumber(val) +
                                       ' (' + ((val / tot) * 100).toFixed(1) + '%)';
                            }
                        }
                    }
                }
            }
        });
    }

    /* ── Top-5 extensions list ─────────────────────────────────────────── */
    function _renderTopExtensions(exts, totalFiles) {
        var el = document.getElementById('extensionsList');
        if (!el) return;
        if (!exts.length) { el.innerHTML = '<div class="empty-state"><p>No data</p></div>'; return; }

        var top5     = exts.slice(0, 5);
        var maxCount = (top5[0] && (top5[0].count || top5[0].file_count)) || 1;
        var html = '';

        top5.forEach(function (e, i) {
            var name  = (e.ext || e.extension || '').replace(/^\./, '') || '?';
            var count = e.count || e.file_count || 0;
            var pct   = totalFiles > 0 ? ((count / totalFiles) * 100).toFixed(1) : '0';
            var barW  = maxCount  > 0 ? ((count / maxCount)  * 100).toFixed(1) : '0';
            var color = COLORS[i] || COLORS[0];

            html +=
                '<div class="ext-item">' +
                    '<span class="ext-rank">' + (i + 1) + '</span>' +
                    '<i class="fas ' + Utils.getFileIcon(name) + ' ext-icon-fa" style="color:' + color + '"></i>' +
                    '<div class="ext-body">' +
                        '<div class="ext-top">' +
                            '<span class="ext-name">.' + _esc(name) + '</span>' +
                            '<span>' +
                                '<span class="ext-count">' + Utils.formatNumber(count) + '</span>' +
                                '<span class="ext-pct">' + pct + '%</span>' +
                            '</span>' +
                        '</div>' +
                        '<div class="ext-bar-bg">' +
                            '<div class="ext-bar-fg" style="width:' + barW + '%;background:' + color + '"></div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
        });
        el.innerHTML = html;
    }

    /* ── Scan info card ────────────────────────────────────────────────── */
    function _renderScanInfoCard(data) {
        var el = document.getElementById('scanInfoCard');
        if (!el) return;

        var s    = Store.get('currentScanMeta') || {};
        var rows = [
            { icon: 'fa-folder',        key: 'Folder',    val: Scanner.pathName(s.path || data.path || ''), plain: true },
            { icon: 'fa-route',         key: 'Full Path', val: s.path || data.path || '—' },
            { icon: 'fa-calendar-plus', key: 'Scanned',   val: s.created_at ? _fmtDate(s.created_at) : '—', plain: true },
            { icon: 'fa-circle-check',  key: 'Status',    val: s.status || 'completed', plain: true }
        ];

        el.innerHTML = rows.map(function (r) {
            return '<div class="info-row">' +
                '<div class="info-row-icon"><i class="fas ' + r.icon + '"></i></div>' +
                '<div>' +
                    '<div class="info-row-key">' + r.key + '</div>' +
                    '<div class="info-row-val' + (r.plain ? ' plain' : '') + '">' + _esc(String(r.val)) + '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    /* ── Tiny helpers ──────────────────────────────────────────────────── */
    function _fmtDate(iso) {
        try {
            var d = new Date(iso);
            return d.toLocaleDateString() + ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) { return String(iso); }
    }

    function _esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    /* ── Public API ────────────────────────────────────────────────────── */
    return { load: load };
})();
