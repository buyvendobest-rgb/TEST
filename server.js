// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const admin = require('firebase-admin'); // Import Firebase Admin SDK

// --- NEW: Load your combined Google Sheets handler functions ---
const combinedSubmitHandler = require('./api/combined-submit.js');
const combinedGetDataHandler = require('./api/combined-get-data.js');

const app = express();
app.use(express.json()); // Middleware to parse JSON request bodies

// Initialize Supabase client for backend authentication
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Initialize Firebase Admin SDK
// IMPORTANT: You'll need to provide your Firebase service account key.
// For security, store this securely (e.g., as an environment variable or
// a separate JSON file referenced by an env var).
// For Canvas testing, you might need to find how __firebase_config is exposed
// or if a service account is automatically configured for the backend.
// For now, let's assume you have a way to get the serviceAccountKey.
// Replace `process.env.FIREBASE_SERVICE_ACCOUNT_KEY` with your actual service account key content
// if you're running this locally and not through the Canvas environment's auto-setup.
try {
    const firebaseConfig = JSON.parse(process.env.FIREBASE_CLIENT_CONFIG || '{}'); // Assuming client config is also available
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        // Parse the service account key JSON string
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
            // You might also need databaseURL if you're using Realtime Database
            // databaseURL: firebaseConfig.databaseURL,
        });
        console.log("Firebase Admin SDK initialized successfully.");
    } else if (firebaseConfig && firebaseConfig.projectId) {
         // Attempt to initialize using Firebase client config if service account is not provided
         // This is less secure for admin operations and typically done for client-side
         // but might be a fallback or specific Canvas setup.
         // For production, always use service account for Admin SDK.
         admin.initializeApp({
            credential: admin.credential.applicationDefault() // Requires GOOGLE_APPLICATION_CREDENTIALS env var
         });
         console.log("Firebase Admin SDK initialized with Application Default Credentials.");
    } else {
        console.warn("Firebase Admin SDK not initialized: FIREBASE_SERVICE_ACCOUNT_KEY or FIREBASE_CLIENT_CONFIG.projectId not found.");
    }
} catch (error) {
    console.error("Failed to initialize Firebase Admin SDK:", error);
}


// --- Middleware for API Routes (Sends JSON errors) ---
const protect = async (req, res, next) => {
    // Get the authentication token from the Authorization header (Bearer token)
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        // If no token is provided, send a 401 Unauthorized JSON response
        return res.status(401).json({ message: 'Unauthorized: No token provided.' });
    }

    try {
        // Verify the token with Supabase to get the user data
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            console.error("Supabase token verification error:", error ? error.message : "No user found for token.");
            // If token is invalid or user not found, send a 401 Unauthorized JSON response
            return res.status(401).json({ message: 'Unauthorized: Invalid token.' });
        }

        // Attach the user object to the request for use in handlers (optional, but good practice)
        req.user = user;
        next(); // Proceed to the next middleware or route handler (your API function)
    } catch (error) {
        console.error("Authentication internal error:", error);
        return res.status(500).json({ message: 'Internal Server Error during authentication.' });
    }
};

// --- Middleware for HTML Routes (Redirects to login) ---
const protectHtml = async (req, res, next) => {
    // Check for a session token in the Authorization header (cookies are not parsed without cookie-parser)
    // For HTML routes, the client-side authentication check in the HTML itself is primary.
    // This server-side check is a fallback/additional layer.
    const token = req.headers.authorization?.split(' ')[1]; // This is for client-side JS initiated fetches

    // If no token, or if it's an initial browser request, client-side JS will handle auth check/redirect.
    // This middleware primarily prevents direct access to HTML paths if an old token is present
    // but invalid, or if client-side JS fails.
    if (!token && req.path !== '/login.html') {
        return res.redirect('/login.html');
    }

    // For better server-side HTML route protection, consider using cookies
    // or a redirect that passes the token securely if your auth flow supports it.
    // For now, rely heavily on the client-side JS authentication for page access.
    next(); // Proceed, client-side JS will do the primary authentication check
};


// --- Static File Serving (from the 'public' directory) ---
// This serves your HTML, CSS, client-side JS, images, etc.
app.use(express.static(path.join(__dirname, 'public')));
// Additionally serve files from subfolders within 'public'
app.use('/Prod', express.static(path.join(__dirname, 'public', 'Prod')));
app.use('/hr', express.static(path.join(__dirname, 'public', 'hr')));
app.use('/cs', express.static(path.join(__dirname, 'public', 'cs')));


// --- Login Endpoint (Unprotected) ---
// Handles the login form submission
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        
        if (error) {
            console.error("Supabase login error:", error.message);
            return res.status(401).json({ message: error.message });
        }

        const supabaseUid = data.user.id;
        let firebaseCustomToken = null;

        // Generate Firebase Custom Token
        if (admin.apps.length > 0) { // Check if Firebase Admin SDK is initialized
            try {
                firebaseCustomToken = await admin.auth().createCustomToken(supabaseUid);
                console.log("Firebase custom token generated for UID:", supabaseUid);
            } catch (firebaseError) {
                console.error("Error creating Firebase custom token:", firebaseError);
                // Continue without Firebase token if it fails, client might still proceed with Supabase only
            }
        } else {
            console.warn("Firebase Admin SDK not initialized, skipping custom token generation.");
        }

        // Return both Supabase session and Firebase custom token
        res.status(200).json({
            session: data.session,
            user: data.user,
            firebaseCustomToken: firebaseCustomToken
        });

    } catch (error) {
        console.error('Login internal server error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// --- HTML Routes ---
// Serve the login HTML file without authentication
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Protect all HTML files that are part of the dashboard/application
// This uses a very light `protectHtml` middleware, relying mostly on client-side JS for robust auth.
app.get([
    '/dashboard.html', 
    '/encoding.html', 
    '/online-tracking.html', 
    '/products.html', 
    '/tech-tracking.html',
    '/Prod/sales.html',       // Add specific paths for files inside Prod folder
    '/Prod/marketing.html',
    '/Prod/inventory.html',
    '/Prod/finance.html',
    '/hr/tracking-and-development.html', // Add specific paths for files inside hr folder
    '/hr/research-and-development.html',
    '/cs/customer-service.html', // Add specific paths for files inside cs folder
    '/admin-permissions.html' // New admin page
], protectHtml, (req, res) => {
    // Determine the full path to the requested file within 'public'
    // req.path will be '/dashboard.html' or '/Prod/sales.html' etc.
    res.sendFile(path.join(__dirname, 'public', req.path));
});

// Redirect root URL to login page
app.get('/', (req, res) => {
    res.redirect('/login.html');
});


// --- API Routes for Google Sheets Integration (Protected by 'protect' middleware) ---
app.post('/api/combined-submit', protect, async (req, res) => {
    await combinedSubmitHandler.handler(req, res); // Call the handler function
});

app.get('/api/combined-get-data', protect, async (req, res) => {
    await combinedGetDataHandler.handler(req, res); // Call the handler function
});

// --- NEW API Routes for User Permissions (Protected by 'protect' and Admin Check) ---
// You will need to implement these handlers in a new file, e.g., './api/user-permissions.js'
// For now, these are placeholders.
/*
const userPermissionsHandler = require('./api/user-permissions.js');

app.get('/api/admin/users-permissions', protect, async (req, res) => {
    // Check if req.user (Supabase user) is an admin before allowing this API
    // This requires fetching the user's roles from Firestore based on req.user.id
    // and then calling userPermissionsHandler.getUsersPermissions(req, res);
});

app.post('/api/admin/set-user-permissions', protect, async (req, res) => {
    // Check if req.user (Supabase user) is an admin before allowing this API
    // Then call userPermissionsHandler.setUserPermissions(req, res);
});
*/


// --- Server Start ---
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; 
app.listen(PORT, HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
    console.log('Ensure your HTML files are in the ./public directory.');
});
