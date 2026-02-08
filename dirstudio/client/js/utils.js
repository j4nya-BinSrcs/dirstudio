/**
 * DirStudio Utility Functions
 * Helper functions for formatting, validation, etc.
 */

var Utils = (function() {
    'use strict';

    /**
     * Format bytes to human readable size
     * @param {number} bytes - Size in bytes
     * @param {number} decimals - Decimal places
     * @returns {string} Formatted size
     */
    function formatBytes(bytes, decimals) {
        decimals = decimals || 2;
        if (bytes === 0) return '0 B';
        
        var k = 1024;
        var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        var i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
    }

    /**
     * Format number with thousands separator
     * @param {number} num - Number to format
     * @returns {string} Formatted number
     */
    function formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /**
     * Get file extension from filename
     * @param {string} filename - File name
     * @returns {string} Extension without dot
     */
    function getExtension(filename) {
        if (!filename) return '';
        var parts = filename.split('.');
        return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
    }

    /**
     * Get file icon class based on extension
     * @param {string} extension - File extension
     * @returns {string} Font Awesome icon class
     */
    function getFileIcon(extension) {
        var icons = {
            'pdf': 'fa-file-pdf',
            'doc': 'fa-file-word',
            'docx': 'fa-file-word',
            'xls': 'fa-file-excel',
            'xlsx': 'fa-file-excel',
            'ppt': 'fa-file-powerpoint',
            'pptx': 'fa-file-powerpoint',
            'jpg': 'fa-file-image',
            'jpeg': 'fa-file-image',
            'png': 'fa-file-image',
            'gif': 'fa-file-image',
            'mp4': 'fa-file-video',
            'avi': 'fa-file-video',
            'mov': 'fa-file-video',
            'mp3': 'fa-file-audio',
            'wav': 'fa-file-audio',
            'zip': 'fa-file-archive',
            'rar': 'fa-file-archive',
            'tar': 'fa-file-archive',
            'txt': 'fa-file-alt',
            'html': 'fa-file-code',
            'css': 'fa-file-code',
            'js': 'fa-file-code',
            'py': 'fa-file-code',
            'java': 'fa-file-code'
        };
        
        return icons[extension] || 'fa-file';
    }

    /**
     * Truncate text with ellipsis
     * @param {string} text - Text to truncate
     * @param {number} maxLength - Maximum length
     * @returns {string} Truncated text
     */
    function truncate(text, maxLength) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    /**
     * Debounce function
     * @param {function} func - Function to debounce
     * @param {number} wait - Wait time in ms
     * @returns {function} Debounced function
     */
    function debounce(func, wait) {
        var timeout;
        return function() {
            var context = this;
            var args = arguments;
            clearTimeout(timeout);
            timeout = setTimeout(function() {
                func.apply(context, args);
            }, wait);
        };
    }

    /**
     * Show toast notification
     * @param {string} message - Message to show
     * @param {string} type - Type: success, error, info
     */
    function showToast(message, type) {
        type = type || 'info';
        // Simple alert for now, can be replaced with better UI
        alert(message);
    }

    /**
     * Generate UUID
     * @returns {string} UUID
     */
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0;
            var v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Validate path
     * @param {string} path - File path
     * @returns {boolean} Is valid
     */
    function isValidPath(path) {
        if (!path || typeof path !== 'string') return false;
        return path.length > 0 && path.trim().length > 0;
    }

    /**
     * Theme management
     */
    function getPreferredTheme() {
        var stored = localStorage.getItem('theme');
        if (stored) return stored;
        return window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
    }

    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }

    function toggleTheme() {
        var current = document.documentElement.getAttribute('data-theme');
        setTheme(current === 'dark' ? 'light' : 'dark');
    }

    // Public API
    return {
        formatBytes: formatBytes,
        formatNumber: formatNumber,
        getExtension: getExtension,
        getFileIcon: getFileIcon,
        truncate: truncate,
        debounce: debounce,
        showToast: showToast,
        generateUUID: generateUUID,
        isValidPath: isValidPath,
        setTheme: setTheme,
        toggleTheme: toggleTheme,
        getPreferredTheme: getPreferredTheme
    };
})();