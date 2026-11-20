import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const maxRequestBytes = 1024;
const maxMessageAge = 2 * 60 * 1000;
const roomIdPattern = /^(?:group_[A-Za-z0-9]{20}|[A-Za-z0-9]{1,128}_[A-Za-z0-9]{1,128})$/;
const messageIdPattern = /^[A-Za-z0-9]{20}$/;
const uidPattern = /^[A-Za-z0-9]{1,128}$/;

function response(status, headers) {
    return new Response(null, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

async function readJson(request) {
    if (!request.body) return null;
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxRequestBytes) {
            void reader.cancel().catch(() => {});
            throw new RangeError();
        }
        chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function notificationData(room, message, roomId) {
    const { type, text, senderName } = message;
    if (typeof senderName !== 'string') return null;
    let body;
    if (type === 'sticker') body = 'スタンプ';
    else if (type === 'image') body = '画像';
    else if (type === 'text' && typeof text === 'string') body = text;
    else return null;

    const isGroup = room.kind === 'group';
    const title = isGroup ? room.name : senderName;
    if (typeof title !== 'string') return null;
    if (isGroup) body = `${senderName}: ${Array.from(body).slice(0, 60).join('')}`;

    // Leave room for the title, identifiers, and Web Push envelope.
    if (Buffer.byteLength(JSON.stringify(body)) > 3000) {
        let size = 2;
        let preview = '';
        for (const character of body) {
            size += Buffer.byteLength(JSON.stringify(character)) - 2;
            if (size > 3000) break;
            preview += character;
        }
        body = preview;
    }
    return { title, body, roomId, tag: roomId };
}

function isInvalidToken(error) {
    return error?.code === 'messaging/registration-token-not-registered' ||
        error?.code === 'messaging/invalid-registration-token' ||
        (error?.code === 'messaging/invalid-argument' && /not a valid FCM registration token/i.test(error.message));
}

async function sendNotifications(app, db, recipients, data) {
    const snapshots = await db.getAll(...recipients.map(uid => db.collection('pushTokens').doc(uid)));
    const tokensByDocument = new Map();
    const uniqueTokens = new Set();
    for (const snapshot of snapshots) {
        const stored = snapshot.data()?.tokens;
        if (!Array.isArray(stored)) continue;
        const tokens = stored.slice(-10).filter(token => typeof token === 'string' && token.length > 0 && token.length <= 4096);
        tokensByDocument.set(snapshot.ref, tokens);
        tokens.forEach(token => uniqueTokens.add(token));
    }
    const tokens = [...uniqueTokens];
    if (tokens.length === 0) return true;

    const { responses } = await getMessaging(app).sendEachForMulticast({ tokens, webpush: { data } });
    const invalidTokens = new Set(tokens.filter((_, index) => isInvalidToken(responses[index].error)));
    const batch = db.batch();
    let needsCleanup = false;
    for (const [ref, stored] of tokensByDocument) {
        const invalid = stored.filter(token => invalidTokens.has(token));
        if (!invalid.length) continue;
        batch.update(ref, { tokens: FieldValue.arrayRemove(...invalid), updatedAt: FieldValue.serverTimestamp() });
        needsCleanup = true;
    }
    if (needsCleanup) await batch.commit();
    return responses.every(result => result.success || isInvalidToken(result.error));
}

export default {
    async fetch(request) {
        if (request.method !== 'POST') return response(405, { Allow: 'POST' });
        if (Number(request.headers.get('content-length')) > maxRequestBytes) return response(413);
        if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
            return response(415);
        }
        const idToken = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
        if (!idToken) return response(401);

        let body;
        try {
            body = await readJson(request);
        } catch (error) {
            return response(error instanceof RangeError ? 413 : 400);
        }
        if (!body || typeof body !== 'object' || Object.keys(body).length !== 2 ||
            typeof body.roomId !== 'string' || !roomIdPattern.test(body.roomId) ||
            typeof body.messageId !== 'string' || !messageIdPattern.test(body.messageId)) return response(400);

        const { roomId, messageId } = body;
        try {
            const app = getApps()[0] ?? initializeApp({
                credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
            });
            let uid;
            try {
                ({ uid } = await getAuth(app).verifyIdToken(idToken));
            } catch {
                return response(401);
            }
            if (!uidPattern.test(uid)) return response(403);

            const db = getFirestore(app);
            const roomRef = db.collection('rooms').doc(roomId);
            const [join, roomSnapshot] = await db.getAll(db.collection('joins').doc(uid), roomRef);
            const room = roomSnapshot.data();
            if (!join.exists || !Array.isArray(room?.members) ||
                room.members.length < 2 || room.members.length > 50 || !room.members.includes(uid)) {
                return response(403);
            }
            const message = (await roomRef.collection('messages').doc(messageId).get()).data();
            if (message?.senderId !== uid || !(message.timestamp instanceof Timestamp) ||
                Math.abs(Date.now() - message.timestamp.toMillis()) > maxMessageAge) return response(403);
            const data = notificationData(room, message, roomId);
            if (!data) return response(200);

            const sent = db.collection('notifySent').doc(`${roomId}_${messageId}`);
            try {
                await sent.create({ createdAt: FieldValue.serverTimestamp() });
            } catch (error) {
                if (error.code === 6) return response(200); // Firestore ALREADY_EXISTS
                throw error;
            }
            const recipients = [...new Set(room.members.filter(member => member !== uid &&
                typeof member === 'string' && uidPattern.test(member)))];
            if (recipients.length === 0) return response(200);
            if (!await sendNotifications(app, db, recipients, data)) {
                console.error('FCM delivery failed for one or more registrations.');
                return response(502);
            }
            return response(200);
        } catch {
            console.error('Push notification request failed.');
            return response(500);
        }
    }
};
