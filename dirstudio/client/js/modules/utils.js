/**
 * Utility functions for DirStudio
 * Enhanced with robust path handling
 */

var Utils = (function() {
    'use strict';

    return {
        /**
         * Validate and normalize path - handles \, /, and \\
         */
        isValidPath: function(path) {
            if (!path || typeof path !== 'string') {
                return false;
            }

            // Trim whitespace
            path = path.trim();

            // Empty path is invalid
            if (path.length === 0) {
                return false;
            }

            // Allow various path formats:
            // Windows: C:\Users\... or C:/Users/... or C:\\Users\\...
            // Unix: /home/... or ~/...
            // UNC: \\server\share or //server/share

            // Check for common invalid patterns
            var invalidChars = /[<>"|?*]/;  // Not allowing these in paths
            if (invalidChars.test(path)) {
                return false;
            }

            return true;
        },

        /**
         * Normalize path - converts all separators to forward slash
         * Handles: \, /, \\, mixed separators
         */
        normalizePath: function(path) {
            if (!path) return '';

            // Trim whitespace
            path = path.trim();

            // Replace all backslashes (single or double) with forward slash
            // This handles: \, \\, and mixed paths
            path = path.replace(/\\\\/g, '/');  // \\ -> /
            path = path.replace(/\\/g, '/');    // \ -> /

            // Remove duplicate slashes (except for UNC paths or protocol://)
            // Keep double slash at the beginning for UNC paths
            if (path.startsWith('//')) {
                path = '//' + path.substring(2).replace(/\/+/g, '/');
            } else {
                path = path.replace(/\/+/g, '/');
            }

            // Remove trailing slash (unless it's root)
            if (path.length > 1 && path.endsWith('/')) {
                path = path.slice(0, -1);
            }

            return path;
        },

        /**
         * Format bytes to human-readable string
         */
        formatBytes: function(bytes, decimals) {
            decimals = decimals || 2;
            
            if (bytes === 0) return '0 Bytes';
            if (!bytes || bytes < 0) return '0 Bytes';

            var k = 1024;
            var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
            var i = Math.floor(Math.log(bytes) / Math.log(k));

            return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
        },

        /**
         * Format number with thousands separator
         */
        formatNumber: function(num) {
            if (!num && num !== 0) return '0';
            return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        },

        /**
         * Get file icon based on extension
         */
        getFileIcon: function(extension) {
            if (!extension) return 'fa-file';

            extension = extension.toLowerCase().replace('.', '');

            var iconMap = {
                // Documents
                'pdf': 'fa-file-pdf',
                'doc': 'fa-file-word',
                'docx': 'fa-file-word',
                'txt': 'fa-file-lines',
                'rtf': 'fa-file-lines',
                'odt': 'fa-file-word',

                // Spreadsheets
                'xls': 'fa-file-excel',
                'xlsx': 'fa-file-excel',
                'csv': 'fa-file-csv',
                'ods': 'fa-file-excel',

                // Presentations
                'ppt': 'fa-file-powerpoint',
                'pptx': 'fa-file-powerpoint',
                'odp': 'fa-file-powerpoint',

                // Images
                'jpg': 'fa-file-image',
                'jpeg': 'fa-file-image',
                'png': 'fa-file-image',
                'gif': 'fa-file-image',
                'bmp': 'fa-file-image',
                'svg': 'fa-file-image',
                'webp': 'fa-file-image',
                'ico': 'fa-file-image',
                'tiff': 'fa-file-image',
                'tif': 'fa-file-image',

                // Video
                'mp4': 'fa-file-video',
                'avi': 'fa-file-video',
                'mkv': 'fa-file-video',
                'mov': 'fa-file-video',
                'wmv': 'fa-file-video',
                'flv': 'fa-file-video',
                'webm': 'fa-file-video',

                // Audio
                'mp3': 'fa-file-audio',
                'wav': 'fa-file-audio',
                'flac': 'fa-file-audio',
                'aac': 'fa-file-audio',
                'ogg': 'fa-file-audio',
                'wma': 'fa-file-audio',
                'm4a': 'fa-file-audio',

                // Archives
                'zip': 'fa-file-zipper',
                'rar': 'fa-file-zipper',
                '7z': 'fa-file-zipper',
                'tar': 'fa-file-zipper',
                'gz': 'fa-file-zipper',
                'bz2': 'fa-file-zipper',
                'xz': 'fa-file-zipper',

                // Code
                'js': 'fa-file-code',
                'jsx': 'fa-file-code',
                'ts': 'fa-file-code',
                'tsx': 'fa-file-code',
                'py': 'fa-file-code',
                'java': 'fa-file-code',
                'cpp': 'fa-file-code',
                'c': 'fa-file-code',
                'h': 'fa-file-code',
                'cs': 'fa-file-code',
                'php': 'fa-file-code',
                'rb': 'fa-file-code',
                'go': 'fa-file-code',
                'rs': 'fa-file-code',
                'swift': 'fa-file-code',
                'kt': 'fa-file-code',
                'r': 'fa-file-code',
                'sql': 'fa-file-code',
                'sh': 'fa-file-code',
                'bat': 'fa-file-code',
                'ps1': 'fa-file-code',

                // Web
                'html': 'fa-file-code',
                'htm': 'fa-file-code',
                'css': 'fa-file-code',
                'scss': 'fa-file-code',
                'sass': 'fa-file-code',
                'less': 'fa-file-code',
                'json': 'fa-file-code',
                'xml': 'fa-file-code',
                'yaml': 'fa-file-code',
                'yml': 'fa-file-code',

                // Executables
                'exe': 'fa-file-circle-exclamation',
                'msi': 'fa-file-circle-exclamation',
                'app': 'fa-file-circle-exclamation',
                'dmg': 'fa-file-circle-exclamation',
                'deb': 'fa-file-circle-exclamation',
                'rpm': 'fa-file-circle-exclamation'
            };

            return iconMap[extension] || 'fa-file';
        },

        /**
         * Get file extension from path
         */
        getExtension: function(path) {
            if (!path) return '';
            var parts = path.split('.');
            return parts.length > 1 ? parts[parts.length - 1] : '';
        },

        /**
         * Show toast notification
         */
        showToast: function(message, type) {
            type = type || 'info';

            var colors = {
                'success': '#10b981',
                'error': '#ef4444',
                'warning': '#f59e0b',
                'info': '#6366f1'
            };

            var icons = {
                'success': '✓',
                'error': '✕',
                'warning': '⚠',
                'info': 'ⓘ'
            };

            var toast = document.createElement('div');
            toast.style.cssText = 'position: fixed; bottom: 20px; right: 20px; padding: 16px 24px; ' +
                'background: ' + (colors[type] || colors.info) + '; color: white; border-radius: 8px; ' +
                'box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10000; font-size: 14px; ' +
                'font-family: Inter, sans-serif; max-width: 400px; animation: slideIn 0.3s ease;';
            
            toast.innerHTML = '<strong>' + icons[type] + '</strong> ' + message;

            document.body.appendChild(toast);

            setTimeout(function() {
                toast.style.animation = 'slideOut 0.3s ease';
                setTimeout(function() {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 300);
            }, 3000);
        },

        /**
         * Theme management
         */
        getPreferredTheme: function() {
            var stored = localStorage.getItem('theme');
            if (stored) {
                return stored;
            }
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        },

        setTheme: function(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('theme', theme);
            
            var icon = document.querySelector('#themeToggleBtn i');
            if (icon) {
                icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            }
        },

        toggleTheme: function() {
            var current = Utils.getPreferredTheme();
            var next = current === 'dark' ? 'light' : 'dark';
            Utils.setTheme(next);
        },

        /**
         * Debounce function
         */
        debounce: function(func, wait) {
            var timeout;
            return function() {
                var context = this;
                var args = arguments;
                clearTimeout(timeout);
                timeout = setTimeout(function() {
                    func.apply(context, args);
                }, wait);
            };
        },

        /**
         * Deep clone object
         */
        deepClone: function(obj) {
            return JSON.parse(JSON.stringify(obj));
        }
    };
})();

// Add CSS animation for toast
var style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);