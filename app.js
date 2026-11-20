import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp,
    doc, updateDoc, arrayUnion, where, setDoc, getDocFromServer, deleteDoc, runTransaction, Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const VAPID_PUBLIC_KEY = 'BFiu-rhmiSJGGCIYkdvZt_FWwOc_hhda7A4ejxIuRSsNW-mRtVbjHsyLZqDcCRDc7XK9xvAxhv8JKr70fuAKrcY';
const vapidKey = VAPID_PUBLIC_KEY.trim();
const pushConfigured = Boolean(vapidKey && vapidKey !== 'REPLACE_WITH_VAPID_KEY');
const firebaseConfig = {
    apiKey: "AIzaSyCbFEZH9VywEFumJRbbqPftEJAZJDb8hQ0",
    authDomain: "my-line-chat-f467e.firebaseapp.com",
    projectId: "my-line-chat-f467e",
    storageBucket: "my-line-chat-f467e.firebasestorage.app",
    messagingSenderId: "175651281929",
    appId: "1:175651281929:web:0644d6cd4449edbbfb6cd8"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const serviceWorkerRegistration = 'serviceWorker' in navigator
    ? navigator.serviceWorker.register('./sw.js').catch(error => {
        console.error('Service Worker の登録に失敗しました。', error);
        return null;
    })
    : Promise.resolve(null);

const byId = id => document.getElementById(id);
const screens = { auth: byId('authScreen'), list: byId('listScreen'), room: byId('roomScreen') };
const wideLayout = window.matchMedia('(min-width: 768px)');
const authSchool = byId('authSchool');
const authColors = byId('authColors');
const authName = byId('authName');
const authBtn = byId('authBtn');
const authError = byId('authError');
const profileSettingsBtn = byId('profileSettingsBtn');
const roomList = byId('roomList');
const pushPrompt = byId('pushPrompt');
const pushPromptEnable = byId('pushPromptEnable');
const pushPromptHint = byId('pushPromptHint');
const pushSettings = byId('pushSettings');
const pushSettingsEnable = byId('pushSettingsEnable');
const pushSettingsStatus = byId('pushSettingsStatus');
const pushSettingsHint = byId('pushSettingsHint');
const chatLog = byId('chatLog');
const chatInput = byId('chatInput');
const sendBtn = byId('sendBtn');
const imageInput = byId('imageInput');
const chatTitle = byId('chatTitle');
const stickerPicker = byId('stickerPicker');
const replyPreviewBox = byId('replyPreviewBox');
const announcementBar = byId('announcementBar');
const messageActionModal = byId('messageActionModal');
const actionUnsendBtn = byId('actionUnsendBtn');
const groupDrawer = byId('groupDrawer');
const maxJoinAttempts = 3;
const joinLockDuration = 60 * 60 * 1000;

let joining = false;
let joinUnlockAt = 0;
let joinUnlockTimer;
let activeScreen = 'auth';
let currentUserId = null;
let currentRoomId = null;
let members = new Map();
let rooms = new Map();
const roomFeeds = new Map();
let unsubscribeMembers;
let unsubscribeRooms;
let unsubscribeAnnouncement;
let announcementId;
let replyToMessage;
let selectedMessage;
let bannerTimeout;
let linkedRoomId = new URLSearchParams(location.search).get('room');

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)');
const needsHomeScreen = () => isIOS && navigator.standalone !== true && !standalone.matches;
const pushPromptDismissedKey = 'my-line-push-prompt-dismissed';
const homeScreenHint = 'Safari の共有 → ホーム画面に追加 してから開くと通知を受け取れます';
let pushPromptDismissed = false;
let messagingSdk;
let messagingReady;
let pushRegistration;
let pushRegistrationFailed = false;
let lastPushPermission;

function renderPushSettings() {
    const installFirst = needsHomeScreen();
    const available = pushConfigured && currentUserId && (installFirst || messagingSdk);
    const permission = window.Notification?.permission || 'default';
    lastPushPermission = permission;
    const canEnable = !installFirst && (permission === 'default' ||
        (permission === 'granted' && pushRegistrationFailed));
    pushPrompt.hidden = !available || pushPromptDismissed || permission !== 'default';
    pushPromptEnable.hidden = installFirst;
    pushPromptHint.hidden = !installFirst;
    pushPromptEnable.disabled = Boolean(pushRegistration);
    pushSettings.hidden = !available;
    pushSettingsEnable.hidden = !canEnable;
    pushSettingsEnable.disabled = Boolean(pushRegistration);

    let status = 'オフ';
    let hint = '';
    if (installFirst) {
        hint = homeScreenHint;
    } else if (permission === 'denied') {
        status = 'ブロック中';
        hint = isIOS ? '「設定」→「通知」→「my-line」で通知を許可してください。'
            : 'ブラウザーのサイト設定で、このサイトの通知を許可してください。';
    } else if (pushRegistration) {
        status = '設定中…';
    } else if (pushRegistrationFailed) {
        hint = '通知の設定に失敗しました。もう一度お試しください。';
    } else if (permission === 'granted') {
        status = 'オン';
    }
    pushSettingsStatus.textContent = status;
    pushSettingsHint.textContent = hint;
    pushSettingsHint.hidden = !hint;
}

async function savePushToken(uid) {
    const registration = await serviceWorkerRegistration;
    if (!registration) throw new Error('Service Worker unavailable');
    const activeRegistration = registration.active ? registration : await navigator.serviceWorker.ready;
    if (uid !== currentUserId || Notification.permission !== 'granted') return;
    const { getMessaging, getToken } = messagingSdk;
    const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: activeRegistration });
    if (!token) throw new Error('FCM token unavailable');
    if (uid !== currentUserId) return;

    const ref = doc(db, 'pushTokens', uid);
    // 匿名ログインの uid は端末（ブラウザー）ごとなので、最新のトークン1つだけを残す。
    // 古いトークンが残ると同じ端末に通知が重複して届く。
    await setDoc(ref, { tokens: [token], updatedAt: serverTimestamp() });
}

function registerPushForCurrentUser(permission) {
    const uid = currentUserId;
    if (!uid || pushRegistration) return;
    pushRegistrationFailed = false;
    pushRegistration = Promise.resolve(permission).then(result => {
        if (result === 'granted' && uid === currentUserId) return savePushToken(uid);
    }).catch(() => {
        if (uid === currentUserId) pushRegistrationFailed = true;
    }).finally(() => {
        pushRegistration = undefined;
        if (currentUserId && uid !== currentUserId) refreshPushSettings();
        else renderPushSettings();
    });
    renderPushSettings();
}

function refreshPushSettings() {
    renderPushSettings();
    if (!pushConfigured || !currentUserId || needsHomeScreen()) return;
    messagingReady ??= import('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js')
        .then(async sdk => await sdk.isSupported() ? sdk : undefined).catch(() => undefined);
    void messagingReady.then(sdk => {
        messagingSdk = sdk;
        if (sdk && window.Notification?.permission === 'granted') registerPushForCurrentUser('granted');
        else renderPushSettings();
    });
}

if (pushConfigured) {
    pushPromptHint.textContent = homeScreenHint;
    try {
        pushPromptDismissed = localStorage.getItem(pushPromptDismissedKey) === '1';
    } catch {}
    byId('pushPromptClose').addEventListener('click', () => {
        pushPromptDismissed = true;
        try {
            localStorage.setItem(pushPromptDismissedKey, '1');
        } catch {}
        renderPushSettings();
    });

    const enablePush = () => {
        if (!currentUserId || !messagingSdk || pushRegistration || needsHomeScreen()) return;
        const permission = Notification.permission;
        if (permission !== 'denied') {
            registerPushForCurrentUser(permission === 'default' ? Notification.requestPermission() : permission);
        }
    };
    pushPromptEnable.addEventListener('click', enablePush);
    pushSettingsEnable.addEventListener('click', enablePush);
    standalone.addEventListener('change', refreshPushSettings);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (window.Notification?.permission === 'granted' && lastPushPermission !== 'granted') refreshPushSettings();
        else renderPushSettings();
    });
}

navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'is-room-open' && event.ports[0]) {
        event.ports[0].postMessage(document.visibilityState === 'visible' &&
            activeScreen === 'room' && currentRoomId === event.data.roomId);
    }
});

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function appendImage(container, url, alt) {
    const image = element('img');
    image.src = url;
    image.alt = alt;
    container.appendChild(image);
    return image;
}

function lineIcon(name) {
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(svgNamespace, 'svg');
    const use = document.createElementNS(svgNamespace, 'use');
    icon.classList.add('icon');
    icon.setAttribute('aria-hidden', 'true');
    use.setAttribute('href', `#icon-${name}`);
    icon.append(use);
    return icon;
}

function setAvatar(container, url, isGroup = false) {
    container.replaceChildren();
    container.classList.toggle('avatar-group', isGroup);
    if (url) appendImage(container, url, 'アバター');
    else container.append(lineIcon(isGroup ? 'group' : 'person'));
}

function listItem(name, iconUrl, detail, onClick, isGroup = false) {
    const item = element('button', 'list-item');
    item.type = 'button';
    const icon = element('span', 'item-icon');
    setAvatar(icon, iconUrl, isGroup);
    const info = element('span', 'item-info');
    info.append(element('span', 'item-name', name));
    if (detail) info.append(element('span', 'item-sub', detail));
    item.append(icon, info);
    item.addEventListener('click', onClick);
    return item;
}

function syncScreens() {
    for (const [name, screen] of Object.entries(screens)) {
        const visible = name === activeScreen || (wideLayout.matches && activeScreen === 'room' && name === 'list');
        screen.classList.toggle('active', visible);
        screen.inert = !visible;
    }
}

function showScreen(key) {
    activeScreen = key;
    syncScreens();
}

wideLayout.addEventListener('change', syncScreens);

function setScreenSize() {
    document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
}
window.addEventListener('resize', setScreenSize);
window.addEventListener('orientationchange', setScreenSize);
setScreenSize();

function enterApp(uid, profile) {
    if (currentUserId === uid) return;
    currentUserId = uid;
    members.set(uid, profile);
    renderMyProfileAvatar();
    showScreen('list');
    startMemberListListener(uid);
    startRoomsListener(uid);
    refreshPushSettings();
}

function leaveApp() {
    closeRoom();
    unsubscribeMembers?.();
    unsubscribeRooms?.();
    for (const feed of roomFeeds.values()) feed.unsubscribe();
    roomFeeds.clear();
    rooms.clear();
    members.clear();
    currentUserId = null;
    pushRegistrationFailed = false;
    renderPushSettings();
    profileModal.classList.remove('active');
    createRoomModal.classList.remove('active');
    roomList.replaceChildren();
    document.querySelector('.notification-banner')?.classList.remove('active');
    showScreen('auth');
}

function attemptUnlockTime(attempt) {
    // The third attempt stores the server time. The rules and UI both add one hour.
    return attempt?.count === maxJoinAttempts ? attempt.lockedUntil.toMillis() + joinLockDuration : 0;
}

function updateJoinLock(unlockAt = joinUnlockAt) {
    clearTimeout(joinUnlockTimer);
    joinUnlockAt = unlockAt;
    const remaining = unlockAt - Date.now();
    const locked = remaining > 0;
    if (!locked && authSchool.disabled) authError.textContent = '';
    authSchool.disabled = authColors.disabled = authName.disabled = locked;
    authBtn.disabled = joining || locked;
    if (locked) {
        const time = new Date(unlockAt).toLocaleString('ja-JP');
        authError.textContent = `3回間違えたため、1時間ロックしました\n解除時刻 ${time}`;
        joinUnlockTimer = setTimeout(updateJoinLock, remaining);
    }
    return locked;
}

async function readOwnProfile(ref) {
    try {
        return await getDocFromServer(ref);
    } catch (error) {
        if (error.code !== 'permission-denied') throw error;
        return null;
    }
}

function recordJoinAttempt(ref, guess) {
    return runTransaction(db, async transaction => {
        const previous = (await transaction.get(ref)).data();
        if (attemptUnlockTime(previous) > Date.now()) return 0;
        const count = previous && previous.count < maxJoinAttempts ? previous.count + 1 : 1;
        transaction.set(ref, { count, guess, lockedUntil: count === maxJoinAttempts ? serverTimestamp() : Timestamp.fromMillis(0) });
        return count;
    });
}

byId('authForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (authBtn.disabled) return;

    const school = authSchool.value.normalize('NFKC').replace(/\s/g, '');
    const colors = [...authColors.querySelectorAll('input:checked')].map(input => input.value);
    const code = `${school}|${colors.join(',')}`;
    const name = authName.value.trim();
    authError.textContent = '';
    if (!name) {
        authError.textContent = '名前を入力してください';
        authName.focus();
        return;
    }

    joining = true;
    authBtn.disabled = true;
    try {
        const user = auth.currentUser?.isAnonymous ? auth.currentUser : (await signInAnonymously(auth)).user;
        const profileRef = doc(db, 'members', user.uid);
        const attemptRef = doc(db, 'attempts', user.uid);
        let count = 0;
        let joined = false;
        try {
            count = await recordJoinAttempt(attemptRef, code);
            if (count) {
                await setDoc(doc(db, 'joins', user.uid), { code });
                joined = true;
            }
        } catch (error) {
            if (error.code !== 'permission-denied') throw error;
        }
        // プロフィール作成だけに失敗した場合は、参加済みの UID で作成をやり直せる。
        if (!joined && !await readOwnProfile(profileRef)) {
            const attempt = (await getDocFromServer(attemptRef)).data();
            if (updateJoinLock(attemptUnlockTime(attempt))) return;
            if (!count || attempt?.guess !== code) throw new Error('参加の試行を確認できませんでした');
            authError.textContent = `答えが違います（あと${maxJoinAttempts - attempt.count}回）`;
            authSchool.focus();
            return;
        }

        const profile = await runTransaction(db, async transaction => {
            const existing = await transaction.get(profileRef);
            if (existing.exists()) return existing.data();
            const newProfile = { name, status: '', iconUrl: '', createdAt: serverTimestamp() };
            transaction.set(profileRef, newProfile);
            return newProfile;
        });

        if (auth.currentUser?.uid === user.uid) {
            updateJoinLock(0);
            event.target.reset();
            enterApp(user.uid, profile);
        }
    } catch (error) {
        authError.textContent = error.code === 'auth/operation-not-allowed'
            ? '匿名ログインが有効になっていません'
            : '参加できませんでした。もう一度お試しください';
    } finally {
        joining = false;
        updateJoinLock();
    }
});

function compressImage(file, maximumSize, quality) {
    const url = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onerror = () => reject(new Error('画像を読み込めません'));
        image.onload = () => {
            try {
                const scale = Math.min(1, maximumSize / Math.max(image.width, image.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            } catch (error) {
                reject(error);
            }
        };
        image.src = url;
    }).finally(() => URL.revokeObjectURL(url));
}

const profileModal = byId('profileModal');
const profileModalName = byId('profileModalName');
const profileModalStatus = byId('profileModalStatus');
const profileModalIcon = byId('profileModalIcon');
const profileSaveBtn = byId('profileSaveBtn');
let profileIconUrl = '';

function openProfileModal() {
    const profile = members.get(currentUserId);
    profileModalName.value = profile.name;
    profileModalStatus.value = profile.status;
    profileIconUrl = profile.iconUrl;
    setAvatar(profileModalIcon, profileIconUrl);
    renderPushSettings();
    profileModal.classList.add('active');
}

byId('profileIconInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    profileSaveBtn.disabled = true;
    try {
        profileIconUrl = await compressImage(file, 150, 0.8);
        setAvatar(profileModalIcon, profileIconUrl);
    } catch {
        alert('画像の読み込みに失敗しました。');
    } finally {
        event.target.value = '';
        profileSaveBtn.disabled = false;
    }
});

profileSaveBtn.addEventListener('click', async () => {
    const name = profileModalName.value.trim();
    if (!name) {
        alert('名前を入力してください。');
        profileModalName.focus();
        return;
    }
    profileSaveBtn.disabled = true;
    try {
        await updateDoc(doc(db, 'members', currentUserId), {
            name, status: profileModalStatus.value.trim(), iconUrl: profileIconUrl
        });
        profileModal.classList.remove('active');
    } catch {
        alert('プロフィールを保存できませんでした。');
    } finally {
        profileSaveBtn.disabled = false;
    }
});
byId('profileCloseBtn').addEventListener('click', () => profileModal.classList.remove('active'));

profileSettingsBtn.addEventListener('click', openProfileModal);

function renderMyProfileAvatar() {
    const profile = members.get(currentUserId);
    setAvatar(profileSettingsBtn, profile.iconUrl);
}

function friends() {
    return [...members].filter(([uid]) => uid !== currentUserId)
        .sort(([, first], [, second]) => first.name.localeCompare(second.name, 'ja'));
}

function startMemberListListener(uid) {
    unsubscribeMembers = onSnapshot(collection(db, 'members'), snapshot => {
        const updatedMembers = new Map(snapshot.docs.map(member => [member.id, member.data()]));
        if (!updatedMembers.has(uid)) {
            if (!snapshot.metadata.fromCache) leaveApp();
            return;
        }
        members = updatedMembers;
        renderMyProfileAvatar();
        if (createRoomModal.classList.contains('active')) renderGroupMemberOptions();
        renderRoomList();
        if (currentRoomId) {
            renderRoomTitle();
            if (groupDrawer.classList.contains('active')) renderDrawerMembers();
        }
    }, error => console.error('メンバー一覧の取得に失敗しました。', error));
}

const createRoomModal = byId('createRoomModal');
const createRoomModalName = byId('createRoomModalName');
const createRoomModalIcon = byId('createRoomModalIcon');
const createRoomModalBtn = byId('createRoomModalBtn');
const createRoomMembers = byId('createRoomMembers');
let roomIconUrl = '';

function renderGroupMemberOptions() {
    const selected = new Set([...createRoomMembers.querySelectorAll('input:checked')].map(input => input.value));
    createRoomMembers.replaceChildren();
    for (const [uid, friend] of friends()) {
        const option = element('label', 'group-member-option');
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.value = uid;
        checkbox.checked = selected.has(uid);
        option.append(checkbox, element('span', '', friend.name));
        createRoomMembers.append(option);
    }
}

byId('saveRoomBtn').addEventListener('click', () => {
    createRoomModalName.value = '';
    setAvatar(createRoomModalIcon, '', true);
    roomIconUrl = '';
    createRoomMembers.replaceChildren();
    renderGroupMemberOptions();
    createRoomModal.classList.add('active');
});
byId('createRoomCloseBtn').addEventListener('click', () => createRoomModal.classList.remove('active'));

byId('createRoomIconInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    createRoomModalBtn.disabled = true;
    try {
        roomIconUrl = await compressImage(file, 150, 0.8);
        setAvatar(createRoomModalIcon, roomIconUrl, true);
    } catch {
        alert('画像の読み込みに失敗しました。');
    } finally {
        event.target.value = '';
        createRoomModalBtn.disabled = false;
    }
});

createRoomModalBtn.addEventListener('click', async () => {
    const name = createRoomModalName.value.trim();
    const selected = [...createRoomMembers.querySelectorAll('input:checked')].map(input => input.value);
    if (!name) {
        alert('グループ名を入力してください。');
        return;
    }
    if (selected.length < 1 || selected.length > 49) {
        alert('メンバーを1〜49人選んでください。');
        return;
    }

    const uid = currentUserId;
    const roomId = `group_${doc(collection(db, 'rooms')).id}`;
    const room = {
        kind: 'group', name, iconUrl: roomIconUrl, members: [uid, ...selected],
        createdBy: uid, createdAt: serverTimestamp()
    };
    createRoomModalBtn.disabled = true;
    try {
        await setDoc(doc(db, 'rooms', roomId), room);
        if (uid === currentUserId) {
            if (!rooms.has(roomId)) rooms.set(roomId, room);
            createRoomModal.classList.remove('active');
            openRoom(roomId);
        }
    } catch {
        alert('グループを作成できませんでした。');
    } finally {
        createRoomModalBtn.disabled = false;
    }
});

function directRoomId(uid, friendId) {
    return [uid, friendId].sort().join('_');
}

async function openPrivateChat(friendId, roomId) {
    const uid = currentUserId;
    const participantIds = [uid, friendId].sort();
    if (!rooms.has(roomId)) {
        const room = { kind: 'direct', members: participantIds };
        await setDoc(doc(db, 'rooms', roomId), room);
        if (uid !== currentUserId) return;
        if (!rooms.has(roomId)) rooms.set(roomId, room);
    }
    openRoom(roomId);
}

function startRoomsListener(uid) {
    const joinedRooms = query(collection(db, 'rooms'), where('members', 'array-contains', uid));
    let listedRoomsFromServer = false;
    unsubscribeRooms = onSnapshot(joinedRooms, { includeMetadataChanges: true }, snapshot => {
        rooms = new Map(snapshot.docs.map(room => [room.id, room.data()]));
        for (const [roomId, feed] of roomFeeds) {
            if (rooms.has(roomId)) continue;
            feed.unsubscribe();
            roomFeeds.delete(roomId);
        }
        for (const roomId of rooms.keys()) watchRoomMessages(roomId, listedRoomsFromServer);
        if (!snapshot.metadata.fromCache) listedRoomsFromServer = true;
        if (currentRoomId && !rooms.has(currentRoomId) && !snapshot.metadata.fromCache) {
            closeRoom();
            showScreen('list');
        }
        if (linkedRoomId && !snapshot.metadata.fromCache) {
            const roomId = linkedRoomId;
            linkedRoomId = null;
            const url = new URL(location.href);
            url.searchParams.delete('room');
            history.replaceState(history.state, '', url);
            if (rooms.has(roomId)) openRoom(roomId);
        }
        renderRoomList();
    }, error => console.error('トーク一覧の取得に失敗しました。', error));
}

function watchRoomMessages(roomId, notifyFirstUnread = false) {
    if (roomFeeds.has(roomId)) return;
    const feed = { messages: [], byId: new Map(), synced: false, pendingReceipts: new Set() };
    roomFeeds.set(roomId, feed);
    const history = query(collection(db, 'rooms', roomId, 'messages'), orderBy('timestamp', 'asc'));
    feed.unsubscribe = onSnapshot(history, { includeMetadataChanges: true }, snapshot => {
        const messages = snapshot.docs.map(record => ({ ...record.data(), id: record.id })).filter(message => message.timestamp);
        const firstServerSnapshot = !feed.synced && !snapshot.metadata.fromCache;
        if (roomId !== currentRoomId && (feed.synced || (notifyFirstUnread && firstServerSnapshot))) {
            const latest = messages.findLast(message => (firstServerSnapshot || !feed.byId.has(message.id)) &&
                message.senderId !== currentUserId && message.type !== 'unsent' &&
                !message.readUsers.includes(currentUserId));
            if (latest) showInAppNotification(roomId, latest);
        }
        feed.messages = messages;
        feed.byId = new Map(messages.map(message => [message.id, message]));
        if (!snapshot.metadata.fromCache) feed.synced = true;
        if (roomId === currentRoomId) renderChat();
        renderRoomList();
    }, error => console.error('メッセージの取得に失敗しました。', error));
}

function roomDetails(roomId, useLocalName = true) {
    const room = rooms.get(roomId);
    const peer = room.kind === 'direct' ? members.get(room.members.find(uid => uid !== currentUserId)) : room;
    const localName = useLocalName ? localStorage.getItem(`room_name_${roomId}`) : null;
    return { name: localName || peer?.name || '個人トーク', iconUrl: peer?.iconUrl || '' };
}

function messageSummary(message) {
    if (message.type === 'image') return '[画像]';
    if (message.type === 'unsent') return '送信を取り消しました';
    if (message.type === 'sticker') return STICKERS.get(message.text) ?? message.text;
    return message.text;
}

function listMessagePreview(message) {
    if (message.type === 'sticker') return 'スタンプ';
    if (message.type === 'image') return '画像';
    if (message.type === 'unsent') return 'メッセージの送信を取り消しました';
    return message.text;
}

function listMessageTime(date, today) {
    if (date.toDateString() === today) {
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

function renderRoomList() {
    const entries = [];
    const directRoomsByPeer = new Map();
    for (const [id, room] of rooms) {
        const peerId = room.kind === 'direct' ? room.members.find(uid => uid !== currentUserId) : undefined;
        if (peerId) directRoomsByPeer.set(peerId, id);
        const messages = roomFeeds.get(id)?.messages;
        if (messages?.length) entries.push({ id, peerId, latest: messages.at(-1), messages });
    }
    entries.sort((first, second) => second.latest.timestamp.toMillis() - first.latest.timestamp.toMillis());

    const rows = document.createDocumentFragment();
    const shownPeers = new Set();
    const today = new Date().toDateString();
    for (const { id, peerId, latest, messages } of entries) {
        if (peerId && shownPeers.has(peerId)) continue;
        if (peerId) shownPeers.add(peerId);

        const { name, iconUrl } = roomDetails(id, !peerId);
        const item = listItem(name, iconUrl, listMessagePreview(latest), () => openRoom(id), rooms.get(id).kind === 'group');
        item.dataset.roomId = id;

        const date = latest.timestamp.toDate();
        const time = element('time', 'room-time', listMessageTime(date, today));
        time.dateTime = date.toISOString();
        const meta = element('span', 'room-meta');
        meta.append(time);
        const unread = messages.filter(message => message.type !== 'unsent' &&
            !message.readUsers.includes(currentUserId)).length;
        if (unread) meta.append(element('span', 'room-badge', unread));
        item.append(meta);
        rows.append(item);
    }

    for (const [friendId, friend] of friends()) {
        if (shownPeers.has(friendId)) continue;
        const defaultId = directRoomId(currentUserId, friendId);
        const roomId = rooms.has(defaultId) ? defaultId : directRoomsByPeer.get(friendId) || defaultId;
        const item = listItem(friend.name, friend.iconUrl, '', async () => {
            item.disabled = true;
            try {
                await openPrivateChat(friendId, roomId);
            } catch {
                alert('トークを開けませんでした。');
            } finally {
                item.disabled = false;
            }
        });
        item.dataset.roomId = roomId;
        rows.append(item);
    }
    roomList.replaceChildren(rows);
    syncRoomSelection();
}

function syncRoomSelection() {
    for (const item of roomList.children) {
        if (item.dataset.roomId === currentRoomId) item.setAttribute('aria-current', 'true');
        else item.removeAttribute('aria-current');
    }
}

const notificationBanner = element('div', 'notification-banner');
const notificationIcon = element('div', 'notification-icon');
const notificationTitle = element('div', 'notification-title');
const notificationText = element('div', 'notification-text');
const notificationInfo = element('div', 'notification-info');
const notificationClose = element('button', 'notification-close icon-button');
notificationClose.type = 'button';
notificationClose.setAttribute('aria-label', '通知を閉じる');
notificationClose.append(lineIcon('close'));
notificationInfo.append(notificationTitle, notificationText);
notificationBanner.append(notificationIcon, notificationInfo, notificationClose);
document.querySelector('.chat-container').append(notificationBanner);
let notificationRoomId;

notificationBanner.addEventListener('click', () => {
    if (rooms.has(notificationRoomId)) openRoom(notificationRoomId);
    notificationBanner.classList.remove('active');
});
notificationClose.addEventListener('click', event => {
    event.stopPropagation();
    notificationBanner.classList.remove('active');
});

function showInAppNotification(roomId, message) {
    notificationRoomId = roomId;
    setAvatar(notificationIcon, message.senderIconUrl);
    const title = rooms.get(roomId).kind === 'group'
        ? `${roomDetails(roomId).name} - ${message.senderName}`
        : message.senderName;
    const body = message.type === 'sticker' ? listMessagePreview(message) : messageSummary(message);
    notificationTitle.textContent = title;
    notificationText.textContent = body;
    notificationBanner.classList.add('active');
    clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(() => notificationBanner.classList.remove('active'), 4000);
}

function renderRoomTitle() {
    const { name, iconUrl } = roomDetails(currentRoomId);
    const avatar = element('span', 'item-icon');
    setAvatar(avatar, iconUrl, rooms.get(currentRoomId).kind === 'group');
    avatar.setAttribute('aria-hidden', 'true');
    chatTitle.replaceChildren(avatar, element('span', 'chat-title-text', name));
}

function closeRoom() {
    unsubscribeAnnouncement?.();
    unsubscribeAnnouncement = undefined;
    announcementId = undefined;
    announcementBar.classList.remove('active');
    groupDrawer.classList.remove('active');
    messageActionModal.classList.remove('active');
    stickerPicker.classList.remove('active');
    selectedMessage = undefined;
    clearReply();
    chatInput.value = '';
    chatLog.replaceChildren();
    currentRoomId = null;
    syncRoomSelection();
}

function openRoom(roomId) {
    if (!rooms.has(roomId)) return;
    if (currentRoomId === roomId) return;
    closeRoom();
    currentRoomId = roomId;
    syncRoomSelection();
    showScreen('room');
    renderRoomTitle();
    watchRoomMessages(roomId);
    renderChat();
    unsubscribeAnnouncement = onSnapshot(doc(db, 'rooms', roomId, 'announcements', 'active'), snapshot => {
        announcementId = snapshot.data()?.messageId;
        renderAnnouncement();
    }, error => console.error('アナウンスの取得に失敗しました。', error));
}

byId('backBtn').addEventListener('click', () => {
    closeRoom();
    showScreen('list');
});

function renderDrawerMembers() {
    const { members: participantIds } = rooms.get(currentRoomId);
    byId('drawerMemberCount').textContent = `メンバー (${participantIds.length})`;
    const participants = byId('drawerMemberList');
    participants.replaceChildren();
    for (const uid of participantIds) {
        const profile = members.get(uid);
        const name = profile?.name || 'メンバー';
        const item = element('div', 'drawer-member-item');
        const icon = element('div', 'drawer-member-icon');
        setAvatar(icon, profile?.iconUrl);
        item.append(icon, element('div', 'drawer-member-name', name));
        participants.append(item);
    }
}

byId('menuBtn').addEventListener('click', () => {
    byId('drawerRoomNameInput').value = roomDetails(currentRoomId).name;
    renderDrawerMembers();
    groupDrawer.classList.add('active');
});
byId('closeDrawerBtn').addEventListener('click', () => groupDrawer.classList.remove('active'));
byId('drawerRoomNameSaveBtn').addEventListener('click', () => {
    const name = byId('drawerRoomNameInput').value.trim();
    if (!name) return;
    localStorage.setItem(`room_name_${currentRoomId}`, name);
    groupDrawer.classList.remove('active');
    renderRoomTitle();
    renderRoomList();
});

const STICKERS = new Map([
    ['67', '67'], ['ryokai', '了解'], ['arigato', 'ありがと'], ['gomen', 'ごめん'],
    ['kusa', '草'], ['sorena', 'それな'], ['ha', 'は？'], ['matte', '待って'],
    ['otsu', 'おつ'], ['tensai', '天才'], ['kami', '神'], ['muri', '無理'],
    ['imadoko', '今どこ？'], ['chikoku', '遅刻する'], ['test', 'テストやばい'],
    ['nemui', 'ねむい'], ['oyasumi', 'おやすみ']
]);

const stickerUrl = id => `./stickers/${id}.webp`;

byId('stickerBtn').addEventListener('click', () => {
    if (!stickerPicker.childElementCount) {
        for (const [id, label] of STICKERS) {
            const button = element('button', 'sticker-item');
            button.type = 'button';
            appendImage(button, stickerUrl(id), label);
            button.addEventListener('click', () => {
                stickerPicker.classList.remove('active');
                sendMessage('sticker', id);
            });
            stickerPicker.append(button);
        }
    }
    stickerPicker.classList.toggle('active');
});

async function notifyRecipients(user, roomId, messageId) {
    const idToken = await user.getIdToken();
    await fetch('/api/notify', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ roomId, messageId })
    });
}

async function sendMessage(type, text = '', imageUrl = '') {
    const uid = currentUserId;
    const user = auth.currentUser;
    const roomId = currentRoomId;
    const profile = members.get(uid);
    if (!roomId || !profile || sendBtn.disabled) return;
    const replyId = replyToMessage?.id || '';
    sendBtn.disabled = true;
    try {
        const message = await addDoc(collection(db, 'rooms', roomId, 'messages'), {
            senderId: uid, senderName: profile.name, senderIconUrl: profile.iconUrl,
            type, text, imageUrl, replyTo: replyId, timestamp: serverTimestamp(), readUsers: [uid]
        });
        if (user?.uid === uid) void notifyRecipients(user, roomId, message.id).catch(() => {});
        if (roomId === currentRoomId && uid === currentUserId) {
            if (type === 'text' && chatInput.value.trim() === text) chatInput.value = '';
            if (replyToMessage?.id === replyId) clearReply();
        }
    } catch {
        alert('メッセージを送信できませんでした。');
    } finally {
        sendBtn.disabled = false;
    }
}

function sendText() {
    const text = chatInput.value.trim();
    if (text) sendMessage('text', text);
}
sendBtn.addEventListener('click', sendText);
chatInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) sendText();
});

imageInput.addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file || sendBtn.disabled) return;
    const roomId = currentRoomId;
    const uid = currentUserId;
    sendBtn.disabled = true;
    sendBtn.classList.add('uploading');
    byId('sendLabel').textContent = '送信中';
    let imageUrl = '';
    try {
        try {
            const form = new FormData();
            form.append('image', file);
            const response = await fetch('https://api.imgur.com/3/image', {
                method: 'POST', headers: { Authorization: 'Client-ID 7f20108ecf661ff' }, body: form
            });
            const result = await response.json();
            if (result.success && /^https:\/\/i\.imgur\.com\/[A-Za-z0-9._/-]+$/.test(result.data.link)) {
                imageUrl = result.data.link;
            }
        } catch {
            // Imgur が利用できない場合は圧縮した画像を送る。
        }
        if (!imageUrl) imageUrl = await compressImage(file, 800, 0.7);
    } catch {
        alert('画像の読み込みに失敗しました。');
    } finally {
        sendBtn.disabled = false;
        sendBtn.classList.remove('uploading');
        byId('sendLabel').textContent = '送信';
    }
    if (imageUrl && roomId === currentRoomId && uid === currentUserId) sendMessage('image', '', imageUrl);
});

function clearReply() {
    replyToMessage = undefined;
    replyPreviewBox.classList.remove('active');
}
byId('cancelReplyBtn').addEventListener('click', clearReply);

function scrollToMessage(id) {
    const target = byId(`msg_${id}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const bubble = target?.querySelector('.bubble');
    if (bubble) {
        const style = getComputedStyle(bubble);
        const highlight = style.getPropertyValue('--yellow').trim();
        bubble.animate([{ backgroundColor: highlight, offset: 0 }, { backgroundColor: highlight, offset: 0.8 }, { backgroundColor: style.backgroundColor }], 1500);
    }
}

function renderAnnouncement() {
    const pinned = roomFeeds.get(currentRoomId)?.byId.get(announcementId);
    announcementBar.classList.toggle('active', Boolean(pinned && pinned.type !== 'unsent'));
    if (pinned) byId('announcementText').textContent = `${pinned.senderName}: ${messageSummary(pinned)}`;
}
announcementBar.addEventListener('click', () => scrollToMessage(announcementId));
byId('closeAnnounceBtn').addEventListener('click', async event => {
    event.stopPropagation();
    if (!currentRoomId) return;
    try {
        await deleteDoc(doc(db, 'rooms', currentRoomId, 'announcements', 'active'));
    } catch {
        alert('アナウンスを解除できませんでした。');
    }
});

function openMessageActions(message) {
    selectedMessage = message;
    actionUnsendBtn.style.display = message.senderId === currentUserId ? 'block' : 'none';
    messageActionModal.classList.add('active');
}

function closeMessageActions() {
    messageActionModal.classList.remove('active');
    selectedMessage = undefined;
}

byId('actionCloseBtn').addEventListener('click', closeMessageActions);
byId('actionReplyBtn').addEventListener('click', () => {
    if (!selectedMessage) return;
    replyToMessage = selectedMessage;
    byId('replyPreviewText').textContent = `${selectedMessage.senderName}さんへの返信: ${messageSummary(selectedMessage)}`;
    replyPreviewBox.classList.add('active');
    closeMessageActions();
    chatInput.focus();
});
actionUnsendBtn.addEventListener('click', async () => {
    if (!selectedMessage || !currentRoomId) return;
    const message = selectedMessage;
    try {
        await updateDoc(doc(db, 'rooms', currentRoomId, 'messages', message.id), {
            type: 'unsent', text: '', imageUrl: '', replyTo: ''
        });
        if (selectedMessage === message) closeMessageActions();
    } catch {
        alert('送信を取り消せませんでした。');
    }
});
byId('actionAnnounceBtn').addEventListener('click', async () => {
    if (!selectedMessage || !currentRoomId) return;
    const message = selectedMessage;
    try {
        await setDoc(doc(db, 'rooms', currentRoomId, 'announcements', 'active'), {
            messageId: message.id, pinnedBy: currentUserId, pinnedAt: serverTimestamp()
        });
        if (selectedMessage === message) closeMessageActions();
    } catch {
        alert('アナウンスを設定できませんでした。');
    }
});

function markRead(roomId, feed, message) {
    const uid = currentUserId;
    if (message.readUsers.includes(uid) || feed.pendingReceipts.has(message.id)) return;
    feed.pendingReceipts.add(message.id);
    updateDoc(doc(db, 'rooms', roomId, 'messages', message.id), { readUsers: arrayUnion(uid) })
        .catch(error => console.error('既読にできませんでした。', error))
        .finally(() => feed.pendingReceipts.delete(message.id));
}

function renderChat() {
    const roomId = currentRoomId;
    const feed = roomFeeds.get(roomId);
    const atBottom = chatLog.scrollHeight - chatLog.clientHeight - chatLog.scrollTop < 24;
    const scrollTop = chatLog.scrollTop;
    const history = document.createDocumentFragment();
    let previousDate;
    for (const message of feed.messages) {
        const time = message.timestamp.toDate();
        const date = time.toDateString();
        if (date !== previousDate) {
            const label = time.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })
                .replace('(', '（').replace(')', '）');
            history.append(element('div', 'message-date', label));
            previousDate = date;
        }
        const isMe = message.senderId === currentUserId;
        const row = element('div', 'message');
        row.id = `msg_${message.id}`;
        if (message.type === 'unsent') {
            row.classList.add('unsent');
            row.append(element('div', 'bubble', `${message.senderName}がメッセージの送信を取り消しました`));
            history.append(row);
            continue;
        }
        row.classList.add(isMe ? 'sent' : 'received');
        const isSticker = message.type === 'sticker';
        const stickerLabel = isSticker ? STICKERS.get(message.text) : undefined;
        const bubble = element('div', isSticker ? 'bubble sticker-bubble' : 'bubble');
        if (stickerLabel) bubble.classList.add('image-sticker-bubble');
        if (message.replyTo) {
            const quoted = feed.byId.get(message.replyTo);
            if (quoted) {
                const quote = element('div', 'reply-quote-box');
                quote.append(element('div', 'reply-quote-user', quoted.senderName),
                    element('div', 'reply-quote-text', messageSummary(quoted)));
                quote.addEventListener('click', event => {
                    event.stopPropagation();
                    scrollToMessage(quoted.id);
                });
                bubble.append(quote);
            }
        }
        if (message.type === 'image') {
            appendImage(bubble, message.imageUrl, '画像').className = 'sent-image';
        } else if (stickerLabel) {
            const image = element('img', 'sent-sticker');
            image.alt = stickerLabel;
            image.addEventListener('load', () => image.classList.add('loaded'), { once: true });
            image.src = stickerUrl(message.text);
            bubble.append(image);
        } else {
            bubble.append(element('span', isSticker ? 'sticker' : '', message.text));
        }
        bubble.addEventListener('click', () => openMessageActions(message));
        const status = element('div', 'status-area');
        if (isMe) {
            const readCount = message.readUsers.length - 1;
            if (readCount > 0) {
                status.append(element('span', 'read-status', rooms.get(roomId).kind === 'direct' ? '既読' : `既読 ${readCount}`));
            }
            row.append(bubble);
        } else {
            const avatar = element('div', 'chat-avatar');
            setAvatar(avatar, message.senderIconUrl);
            const wrapper = element('div', 'bubble-wrapper');
            wrapper.append(element('span', 'user-name-label', message.senderName), bubble);
            row.append(avatar, wrapper);
            markRead(roomId, feed, message);
        }
        status.append(element('span', 'time', `${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}`));
        row.append(status);
        history.append(row);
    }
    chatLog.replaceChildren(history);
    chatLog.scrollTop = atBottom ? chatLog.scrollHeight : scrollTop;
    renderAnnouncement();
}

onAuthStateChanged(auth, async user => {
    if (joining) return;
    if (currentUserId && currentUserId !== user?.uid) leaveApp();
    let unlockAt = 0;
    if (user?.isAnonymous) {
        authBtn.disabled = true;
        try {
            const profile = await readOwnProfile(doc(db, 'members', user.uid));
            if (profile?.exists() && auth.currentUser?.uid === user.uid) enterApp(user.uid, profile.data());
            if (!profile) {
                const attempt = await getDocFromServer(doc(db, 'attempts', user.uid));
                unlockAt = attemptUnlockTime(attempt.data());
            }
        } catch {
            authError.textContent = '登録を確認できませんでした。';
        }
    }
    if (!joining && auth.currentUser?.uid === user?.uid) updateJoinLock(unlockAt);
});
