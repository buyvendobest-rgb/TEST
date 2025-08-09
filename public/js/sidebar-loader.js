// sidebar-loader.js

// Function to load the sidebar HTML and attach its functionality
// Now accepts userPermissions (array of strings) and isAdmin (boolean)
export async function loadSidebar(userPermissions = [], isAdmin = false) {
    try {
        const response = await fetch('../sidebar.html'); // Path to sidebar.html (relative from 'js/' folder)
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const sidebarHtml = await response.text();
        document.getElementById('sidebar-container').innerHTML = sidebarHtml;

        // Get references to main sidebar elements AFTER they are loaded into the DOM
        const sidebar = document.getElementById('sidebar-inner');
        const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
        const toggleIcon = document.getElementById('toggle-icon');

        // Re-attach sidebar toggle logic for the main sidebar collapse/expand
        if (sidebarToggleBtn && sidebar && toggleIcon) {
            sidebarToggleBtn.addEventListener('click', () => {
                const isSidebarHidden = sidebar.classList.toggle('sidebar-hidden');
                if (isSidebarHidden) {
                    toggleIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />`; // Hamburger
                } else {
                    toggleIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />`; // Left arrow
                }
            });
        }

        // Handle multiple collapsible sections (Production, Human Resources)
        const collapsibleSections = [
            { toggleId: 'production-toggle', submenuId: 'production-submenu', arrowId: 'production-arrow' },
            { toggleId: 'hr-toggle', submenuId: 'hr-submenu', arrowId: 'hr-arrow' }
        ];

        collapsibleSections.forEach(section => {
            const toggleButton = document.getElementById(section.toggleId);
            const submenu = document.getElementById(section.submenuId);
            const arrow = document.getElementById(section.arrowId);

            if (toggleButton && submenu && arrow) {
                toggleButton.addEventListener('click', (event) => {
                    event.preventDefault(); // Prevent default button behavior
                    submenu.classList.toggle('hidden');
                    arrow.classList.toggle('rotate-90'); // Rotate arrow for visual feedback
                });
            }
        });

        // Set active link based on current page and expand parent submenu if a child is active
        const currentPathname = window.location.pathname; // e.g., "/Prod/sales.html" or "/dashboard.html"
        const navLinks = document.querySelectorAll('.nav-link');

        navLinks.forEach(link => {
            const linkHref = link.getAttribute('href');
            const category = link.getAttribute('data-category');
            const listItem = link.closest('li'); // Get the parent <li> element for hiding

            // --- Permission Check for Sidebar Links ---
            if (category && !isAdmin) { // If it's not an admin, check permissions
                if (!userPermissions.includes(category)) {
                    // Hide the entire list item if the user doesn't have permission
                    if (listItem) {
                        listItem.classList.add('hidden'); 
                    }
                    return; // Skip further processing for this link
                }
            } else if (category === 'admin' && !isAdmin) { // Specifically hide 'admin' link if not admin
                if (listItem) {
                    listItem.classList.add('hidden');
                }
                return;
            }
            // If isAdmin, all links are visible by default unless explicitly hidden (which is not the case here)


            // --- Active Link Highlighting (after permission check) ---
            if (currentPathname === linkHref) {
                link.classList.add('bg-indigo-500', 'text-white'); // Apply active styling

                // If an active link is within a submenu, open its parent submenu
                collapsibleSections.forEach(section => {
                    const submenu = document.getElementById(section.submenuId);
                    const toggleButton = document.getElementById(section.toggleId);
                    const arrow = document.getElementById(section.arrowId);

                    // Check if the current active link is inside this particular submenu
                    if (submenu && toggleButton && arrow && submenu.contains(link)) {
                        submenu.classList.remove('hidden'); // Show the submenu
                        arrow.classList.add('rotate-90'); // Rotate its arrow
                        toggleButton.classList.add('bg-gray-700'); // Optional: Highlight parent toggle when open/active child
                    }
                });
            } else {
                link.classList.remove('bg-indigo-500', 'text-white');
            }
        });

    } catch (error) {
        console.error('Error loading sidebar:', error);
        document.getElementById('sidebar-container').innerHTML = '<p class="text-red-500 p-4">Error loading sidebar.</p>';
    }
}
