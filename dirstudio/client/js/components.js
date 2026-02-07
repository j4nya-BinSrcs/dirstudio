/**
 * DirStudio Component Loader
 * Loads HTML components into page
 */

(function() {
    'use strict';

    var components = {
        header: 'components/header.html',
        footer: 'components/footer.html',
        sidebar: 'components/sidebar.html'
    };

    function loadComponent(name, containerId) {
        var path = components[name];
        if (!path) {
            console.error('Component not found:', name);
            return Promise.reject('Component not found');
        }

        return fetch(path)
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('Failed to load component: ' + name);
                }
                return response.text();
            })
            .then(function(html) {
                var container = document.getElementById(containerId);
                if (container) {
                    container.innerHTML = html;
                }
            })
            .catch(function(error) {
                console.error('Error loading component:', error);
            });
    }

    function loadAllComponents() {
        var promises = [
            loadComponent('header', 'header-container'),
            loadComponent('footer', 'footer-container'),
            loadComponent('sidebar', 'sidebar-container')
        ];

        return Promise.all(promises).then(function() {
            console.log('All components loaded');
            if (window.onComponentsLoaded) {
                window.onComponentsLoaded();
            }
        });
    }

    // Load components when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadAllComponents);
    } else {
        loadAllComponents();
    }
})();