// public/js/auth-rbac.js

// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithCustomToken, onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Exported variables (can be imported by other modules/HTML scripts)
export let db;
export let auth;
export let userId = null;
export let userPermissions = [];
export let isAdminUser = false;
export let isAuthReady = false; // Flag to indicate Firebase Auth is ready

// IMPORTANT: Using a fixed appId since __app_id might not be consistently provided by Canvas.
const appId = 'my-bestbuyvendo-app'; // <<<=== Make sure this matches your Firestore document ID

const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

// Function to initialize Firebase and handle authentication flow
export function initializeFirebaseAndAuth() {
    if (Object.keys(firebaseConfig).length === 0) {
        console.error("Firebase config is missing. Cannot initialize Firebase. Redirecting to login.");
        window.location.href = '/login.html';
        return;
    }

    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);

    let initialAuthCheckDone = false; // Flag to track if onAuthStateChanged has fired once

    // Listen for auth state changes to get userId and fetch permissions
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            userId = user.uid;
            await fetchUserPermissions(userId); // Fetch permissions once user is authenticated
        } else {
            // User is signed out or no user detected initially
            userId = null;
            userPermissions = [];
            isAdminUser = false;
            console.log("User is signed out or no user.");

            // Only redirect if this is NOT the very first auth state check AND a user was previously logged in
            // Or if there's no custom token and no current user.
            if (initialAuthCheckDone || !localStorage.getItem('firebase.custom.token')) {
                console.log("Redirecting to login: User signed out or no custom token.");
                window.location.href = '/login.html';
            }
        }

        // Set isAuthReady and dispatch event only after the *initial* auth state has been determined.
        if (!isAuthReady) {
            isAuthReady = true;
            initialAuthCheckDone = true; // Mark initial check as done
            document.dispatchEvent(new CustomEvent('authReady', {
                detail: {
                    userId: userId,
                    userPermissions: userPermissions,
                    isAdminUser: isAdminUser
                }
            }));
        } else if (user) { // If auth was already ready, and a user is present (e.g., re-eval after token refresh)
             // Dispatch event for pages to react, as permissions might have been updated
             document.dispatchEvent(new CustomEvent('authReady', {
                detail: {
                    userId: userId,
                    userPermissions: userPermissions,
                    isAdminUser: isAdminUser
                }
            }));
        }
    });

    // Attempt to sign in with the custom token from local storage
    const firebaseCustomToken = localStorage.getItem('firebase.custom.token');
    if (firebaseCustomToken) {
        auth.signInWithCustomToken(firebaseCustomToken)
            .then(() => {
                console.log("Signed in with Firebase custom token.");
                // onAuthStateChanged will handle setting userId, permissions, and dispatching authReady
            })
            .catch((error) => {
                console.error("Error signing in with Firebase custom token:", error);
                // If custom token fails, it might be expired or invalid.
                localStorage.removeItem('firebase.custom.token'); // Clear invalid token
                // Trigger a redirect only if there's no user and auth wasn't already determined.
                if (!auth.currentUser && !isAuthReady) {
                    window.location.href = '/login.html';
                }
            });
    } else {
        // No custom token found, redirect only if Firebase auth hasn't already confirmed a user.
        console.warn("No Firebase custom token found. Checking current auth state...");
        if (!auth.currentUser && !isAuthReady) { // Only redirect if truly no token and no current user
            window.location.href = '/login.html';
        }
    }
}

// Function to fetch user permissions from Firestore
async function fetchUserPermissions(uid) {
    if (!db) {
        console.error("Firestore not initialized for permissions fetch.");
        return;
    }
    try {
        const userDocRef = doc(db, `artifacts/${appId}/public/data/user_permissions`, uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            const data = userDocSnap.data();
            userPermissions = data.allowedCategories || [];
            isAdminUser = data.isAdmin || false;
            console.log("User Permissions (fetched):", userPermissions);
            console.log("Is Admin (fetched):", isAdminUser);
        } else {
            // Default permissions if no document exists for the user
            userPermissions = ["dashboard"]; // Default access
            isAdminUser = false;
            console.log("No explicit permissions found for user:", uid, ". Assigning default.");
            // Optionally, create a default permission document for this user.
            // This ensures a document exists for every user that logs in, making them manageable.
            await setDoc(userDocRef, { allowedCategories: userPermissions, isAdmin: isAdminUser }, { merge: true });
        }
    } catch (error) {
        console.error("Error fetching user permissions:", error);
        userPermissions = []; // Assume no permissions on error
        isAdminUser = false;
    }
}

// Function to check if the user has access to the current page content
export function checkPageAccess(pageCategory) {
    if (!isAuthReady) {
        // This function might be called before auth is ready due to async nature.
        // The 'authReady' event listener in each HTML page will re-trigger
        // the page access check and sidebar load once permissions are available.
        console.log("checkPageAccess called before authReady. Waiting for event.");
        return;
    }

    // If user is admin, they have full access to any page
    if (isAdminUser) {
        console.log("Admin user, full access to page granted.");
        hideAccessDeniedOverlay();
        return;
    }

    if (!userId) {
        console.log("No user ID (after auth ready), redirecting to login.");
        window.location.href = '/login.html';
        return;
    }

    if (!userPermissions.includes(pageCategory)) {
        console.warn(`Access Denied: User ${userId} does not have access to ${pageCategory} page.`);
        showAccessDeniedOverlay();
    } else {
        console.log(`Access Granted: User ${userId} has access to ${pageCategory} page.`);
        hideAccessDeniedOverlay();
    }
}

// Display an access denied message overlay
export function showAccessDeniedOverlay() {
    let overlay = document.getElementById('accessDeniedOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'accessDeniedOverlay';
        overlay.classList.add('overlay'); // Apply base overlay styling
        overlay.innerHTML = `
            <div class="overlay-content bg-white p-8 rounded-xl shadow-2xl text-center">
                <h2 class="text-3xl font-bold text-red-600 mb-4">Access Denied!</h2>
                <p class="text-lg text-gray-700 mb-6">You do not have permission to view this page. Please contact your administrator.</p>
                <button id="goToDashboardBtn" class="py-3 px-8 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 transition duration-300 shadow-md transform hover:scale-105">
                    Go to Dashboard
                </button>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('goToDashboardBtn').addEventListener('click', () => {
            window.location.href = '/dashboard.html';
        });
    }
    overlay.style.display = 'flex'; // Show the overlay
}

// Hide the access denied message overlay
export function hideAccessDeniedOverlay() {
    const overlay = document.getElementById('accessDeniedOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// Export the Firebase signOut function for use in HTML files
export const signOutUser = () => {
    firebaseSignOut(auth).then(() => {
        localStorage.removeItem('supabase.auth.token'); // Clear Supabase token
        localStorage.removeItem('firebase.custom.token'); // Clear Firebase custom token
        window.location.href = '/login.html'; // Redirect to login page
    }).catch((error) => {
        console.error("Error signing out:", error);
        alert("Error signing out. Please try again."); 
    });
};

// --- Other Utility Functions (if needed, move from HTML pages here) ---
export function openDriveFolder(url) {
    window.open(url, '_blank');
}
