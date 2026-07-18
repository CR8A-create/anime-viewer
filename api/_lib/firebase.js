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

/**
 * Delete a comment — only if it belongs to userId.
 * @returns {'ok'|'notfound'|'forbidden'}
 */
async function deleteComment(contentId, commentId, userId) {
    if (useFirestore) {
        const ref = db.collection('comments').doc(commentId);
        const snap = await ref.get();
        if (!snap.exists || snap.data().contentId !== contentId) return 'notfound';
        if (!snap.data().userId || snap.data().userId !== userId) return 'forbidden';
        await ref.delete();
        return 'ok';
    }
    const arr = memoryComments.get(contentId) || [];
    const idx = arr.findIndex(c => c.id === commentId);
    if (idx === -1) return 'notfound';
    if (!arr[idx].userId || arr[idx].userId !== userId) return 'forbidden';
    arr.splice(idx, 1);
    return 'ok';
}

// ============================================================
// USERS (cuentas simples usuario+contraseña+edad) + SYNC
// Doc id = username en minúsculas. Fallback en memoria para
// desarrollo local sin credenciales de Firebase.
// ============================================================
const memoryUsers = new Map();   // id -> user doc
const memorySync = new Map();    // id -> data blob

async function getUser(id) {
    if (useFirestore) {
        const snap = await db.collection('users').doc(id).get();
        return snap.exists ? { id: snap.id, ...snap.data() } : null;
    }
    return memoryUsers.get(id) || null;
}

async function createUser(id, data) {
    if (useFirestore) {
        await db.collection('users').doc(id).set(data);
        return { id, ...data };
    }
    memoryUsers.set(id, { id, ...data });
    return { id, ...data };
}

/** Blob de sincronización de "Mi Lista" (favs/historial/progreso). */
async function getSyncData(id) {
    if (useFirestore) {
        const snap = await db.collection('userSync').doc(id).get();
        return snap.exists ? snap.data() : null;
    }
    return memorySync.get(id) || null;
}

async function setSyncData(id, data) {
    if (useFirestore) {
        await db.collection('userSync').doc(id).set({ ...data, updatedAt: new Date().toISOString() });
        return true;
    }
    memorySync.set(id, { ...data, updatedAt: new Date().toISOString() });
    return true;
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
    getComments, addComment, deleteComment,
    getUser, createUser, getSyncData, setSyncData,
    getUserFavorites, addUserFavorite, removeUserFavorite,
    getUserWatched, markAsWatched, removeWatched,
};
