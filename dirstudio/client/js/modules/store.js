/**
 * DirStudio — store.js
 *
 * Centralised, observable application state.
 * All page controllers read from and write to Store rather than
 * keeping their own scattered local variables.
 *
 * Usage:
 *   Store.set('currentScanId', id);
 *   Store.get('currentTreeData');
 *   Store.on('currentScanId', function(id) { ... });
 */

var Store = (function () {
    'use strict';

    /* ── State ─────────────────────────────────────────────────────────── */
    var state = {
        currentScanId   : null,   // string | null
        currentScanMeta : null,   // scan object from API
        currentTreeData : null,   // normalised tree node
        modalFiles      : {       // selected paths per transform modal
            compress : [],
            convert  : [],
            resize   : []
        },
        ws        : null,         // active WebSocket
        pollTimer : null          // setInterval handle
    };

    /* ── Listeners ─────────────────────────────────────────────────────── */
    var listeners = {};

    function on(key, fn) {
        if (!listeners[key]) listeners[key] = [];
        listeners[key].push(fn);
    }

    function off(key, fn) {
        if (!listeners[key]) return;
        listeners[key] = listeners[key].filter(function (f) { return f !== fn; });
    }

    function notify(key, value) {
        (listeners[key] || []).forEach(function (fn) {
            try { fn(value); } catch (e) { console.error('Store listener error', e); }
        });
    }

    /* ── Accessors ─────────────────────────────────────────────────────── */
    function get(key) {
        return state[key];
    }

    function set(key, value) {
        state[key] = value;
        notify(key, value);
    }

    /** Merge partial update into a sub-object (e.g. modalFiles) */
    function merge(key, partial) {
        if (typeof state[key] !== 'object' || state[key] === null) {
            console.warn('Store.merge: key "' + key + '" is not an object');
            return;
        }
        Object.assign(state[key], partial);
        notify(key, state[key]);
    }

    return { get: get, set: set, merge: merge, on: on, off: off };
})();
