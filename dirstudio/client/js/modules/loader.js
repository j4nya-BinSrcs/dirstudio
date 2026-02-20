/**
 * DirStudio — loader.js
 *
 * Fetches HTML fragments (shell components and tab pages) and injects
 * them into their target containers. Fires lifecycle callbacks so page
 * controllers can wire up event listeners after their DOM is ready.
 */

var Loader = (function () {
    'use strict';

    /* ── Registry ─────────────────────────────────────────────────────── */

    /** Shell components: always loaded on boot */
    var SHELL = [
        { file: 'components/header.html',  target: 'header-container' },
        { file: 'components/footer.html',  target: 'footer-container' },
        { file: 'components/sidebar.html', target: 'sidebar-container' }
    ];

    /** Tab pages: loaded on boot and injected into their pane wrappers */
    var PAGES = [
        { file: 'components/page-overview.html',   target: 'page-overview' },
        { file: 'components/page-tree.html',        target: 'page-tree' },
        { file: 'components/page-organize.html',    target: 'page-organize' },
        { file: 'components/page-transform.html',   target: 'page-transform' }
    ];

    /* ── Internal fetch helper ─────────────────────────────────────────── */

    function fetchHTML(file) {
        return fetch(file).then(function (res) {
            if (!res.ok) throw new Error('Failed to load: ' + file + ' (' + res.status + ')');
            return res.text();
        });
    }

    function inject(target, html) {
        var el = document.getElementById(target);
        if (el) {
            el.innerHTML = html;
        } else {
            console.warn('Loader: target #' + target + ' not found');
        }
    }

    function load(descriptor) {
        return fetchHTML(descriptor.file).then(function (html) {
            inject(descriptor.target, html);
        });
    }

    /* ── Public API ────────────────────────────────────────────────────── */

    /**
     * Load all shell components and page templates, then fire the
     * `onAppReady` callback when everything is in the DOM.
     *
     * @param {Function} onAppReady - called when all HTML is injected
     */
    function init(onAppReady) {
        var all = SHELL.concat(PAGES);
        Promise.all(all.map(load))
            .then(function () {
                if (typeof onAppReady === 'function') onAppReady();
            })
            .catch(function (err) {
                console.error('Loader error:', err);
            });
    }

    return { init: init };
})();
