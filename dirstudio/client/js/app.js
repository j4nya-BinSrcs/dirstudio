/**
 * DirStudio — app.js
 *
 * Application entry point. Orchestrates the startup sequence:
 *   1. Loader injects all HTML fragments (shell + pages)
 *   2. Theme is applied
 *   3. Page controllers initialise their DOM listeners
 *   4. Scanner wires the upload zone and loads scan history
 *   5. If a previous scan is remembered, it is restored
 *
 * All feature logic lives in the modules and page controllers.
 * This file intentionally contains no business logic.
 *
 * Depends on: Utils, Store, Loader, API, Scanner,
 *             OverviewPage, TreePage, OrganizePage, TransformPage
 */

(function () {
    'use strict';

    /* ── Boot ──────────────────────────────────────────────────────────── */
    Loader.init(function onAppReady() {

        /* 1. Theme */
        Utils.setTheme(Utils.getPreferredTheme());
        var themeBtn = document.getElementById('themeToggleBtn');
        if (themeBtn) themeBtn.addEventListener('click', Utils.toggleTheme);

        /* 2. Page controllers — wire their DOM event listeners */
        TreePage.init();
        OrganizePage.init();
        TransformPage.init();

        /* 3. Scanner — upload zone + sidebar history */
        Scanner.init();
        Scanner.loadScans();

        /* 4. When any scan finishes → load all tab data */
        Scanner.onScanReady(function (scanId) {
            OverviewPage.load(scanId);
            TreePage.load(scanId);
            OrganizePage.load(scanId);
        });

        /* 5. Restore last scan from previous session */
        var saved = API.getCurrentScan();
        if (saved) Scanner.loadScan(saved);

    });

    /* ── Cleanup on unload ─────────────────────────────────────────────── */
    window.addEventListener('beforeunload', function () {
        var timer = Store.get('pollTimer');
        if (timer) clearInterval(timer);

        var ws = Store.get('ws');
        if (ws) ws.close();
    });

})();
