/**
 * Firebase Admin SDK — Firestore access for Vercel serverless functions.
 * Falls back to in-memory storage if Firebase env vars are not configured.
 *
 * Required env vars (set in Vercel Dashboard):
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY
 */

let db = null;
let useFirestore = false;

try {
    const admin = require('firebase-admin');

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (projectId && clientEmail && privateKey) {
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId,
                    clientEmail,
                    privateKey: privateKey.replace(/\\n/g, '\n'),
                }),
            });
        }
        db = admin.firestore();
        useFirestore = true;
        console.log('✓ Firebase Firestore connected');
    } else {
        console.warn('⚠ Firebase env vars not set — using in-memory fallback for comments');
    }
} catch (e) {
    console.warn('⚠ firebase-admin not available — using in-memory fallback:', e.message);
}

// ============================================================
// IN-MEMORY FALLBACK for comments (ephemeral, resets on cold start)
// ============================================================
const memoryComments = new Map();

/**
 * Get comments for a content ID.
 * @param {string} contentId
 * @returns {Promise<Array>}
 */
async function getComments(contentId) {
    if (useFirestore) {
        // Sin orderBy en la query: where+orderBy exigiría crear un índice
        // compuesto a mano en la consola. Ordenamos en JS (son ≤100 docs).
        const snapshot = await db.collection('comments')
            .where('contentId', '==', contentId)
            .limit(100)
            .get();
        return snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }
    return memoryComments.get(contentId) || [];
}

/**
 * Add a comment.
 * @param {string} contentId
 * @param {object} comment — { name, text, timestamp }
 * @returns {Promise<object>}
 */
async function addComment(contentId, comment) {
    if (useFirestore) {
        const docRef = await db.collection('comments').add({
            contentId,
            ...comment,
        });
        return { id: docRef.id, ...comment };
    }
    // In-memory fallback
    if (!memoryComments.has(contentId)) memoryComments.set(contentId, []);
    const arr = memoryComments.get(contentId);
    const entry = { id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4), ...comment };
    arr.push(entry);
    if (arr.length > 100) arr.shift();
    return entry;
}

// ============================================================
// User Favorites & Watched (Firestore only — requires auth)
// ============================================================

async function getUserFavorites(userId) {
    if (!useFirestore) return [];
    const snapshot = await db.collection('users').doc(userId).collection('favorites').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function addUserFavorite(userId, item) {
    if (!useFirestore) return null;
    const docRef = db.collection('users').doc(userId).collection('favorites').doc(item.contentId);
    await docRef.set({ ...item, addedAt: new Date().toISOString() });
    return { id: item.contentId, ...item };
}

async function removeUserFavorite(userId, contentId) {
    if (!useFirestore) return false;
    await db.collection('users').doc(userId).collection('favorites').doc(contentId).delete();
    return true;
}

async function getUserWatched(userId) {
    if (!useFirestore) return [];
    const snapshot = await db.collection('users').doc(userId).collection('watched').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function markAsWatched(userId, item) {
    if (!useFirestore) return null;
    const docRef = db.collection('users').doc(userId).collection('watched').doc(item.contentId);
    await docRef.set({ ...item, watchedAt: new Date().toISOString() }, { merge: true });
    return { id: item.contentId, ...item };
}

async function removeWatched(userId, contentId) {
    if (!useFirestore) return false;
    await db.collection('users').doc(userId).collection('watched').doc(contentId).delete();
    return true;
}

module.exports = {
    db, useFirestore,
    getComments, addComment,
    getUserFavorites, addUserFavorite, removeUserFavorite,
    getUserWatched, markAsWatched, removeWatched,
};
