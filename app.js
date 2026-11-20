import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp,
    doc, updateDoc, arrayUnion, where, setDoc, getDocFromServer, deleteDoc, runTransaction
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

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

const byId = id => document.getElementById(id);
const screens = { auth: byId('authScreen'), member: byId('memberScreen'), list: byId('listScreen'), room: byId('roomScreen') };
const authSchool = byId('authSchool');
const authColors = byId('authColors');
const authName = byId('authName');
const authBtn = byId('authBtn');
const authError = byId('authError');
const memberList = byId('memberList');
const roomList = byId('roomList');
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

let joining = false;
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

function setAvatar(container, name, url) {
    container.textContent = url ? '' : Array.from(name).slice(0, 2).join('');
    if (url) appendImage(container, url, 'アバター');
}

function listItem(name, iconUrl, detail, onClick) {
    const item = element('button', 'list-item');
    item.type = 'button';
    const icon = element('span', 'item-icon');
    setAvatar(icon, name, iconUrl);
    const info = element('span', 'item-info');
    info.append(element('span', 'item-name', name));
    if (detail) info.append(element('span', 'item-sub', detail));
    item.append(icon, info);
    item.addEventListener('click', onClick);
    return item;
}

function showScreen(key) {
    for (const [name, screen] of Object.entries(screens)) {
        screen.classList.toggle('active', name === key);
        screen.inert = name !== key;
    }
}

function setScreenSize() {
    document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
}
window.addEventListener('resize', setScreenSize);
window.addEventListener('orientationchange', setScreenSize);
setScreenSize();

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }
}

byId('tabTalk').addEventListener('click', () => {
    showScreen('list');
    requestNotificationPermission();
});
byId('tabMember2').addEventListener('click', () => showScreen('member'));

function enterApp(uid, profile) {
    if (currentUserId === uid) return;
    currentUserId = uid;
    members.set(uid, profile);
    renderMyProfileCard();
    showScreen('member');
    startMemberListListener(uid);
    startRoomsListener(uid);
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
    profileModal.classList.remove('active');
    createRoomModal.classList.remove('active');
    memberList.replaceChildren();
    renderRoomList();
    document.querySelector('.notification-banner')?.classList.remove('active');
    showScreen('auth');
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
        try {
            await setDoc(doc(db, 'joins', user.uid), { code });
        } catch (error) {
            if (error.code !== 'permission-denied') throw error;
            // joins は読めないため、プロフィールを読めるかで参加済みかを確認する。
            try {
                await getDocFromServer(profileRef);
            } catch (profileError) {
                if (profileError.code !== 'permission-denied') throw profileError;
                authError.textContent = '答えが違います';
                authSchool.focus();
                return;
            }
        }

        const profile = await runTransaction(db, async transaction => {
            const existing = await transaction.get(profileRef);
            if (existing.exists()) return existing.data();
            const newProfile = { name, status: '', iconUrl: '', createdAt: serverTimestamp() };
            transaction.set(profileRef, newProfile);
            return newProfile;
        });

        if (auth.currentUser?.uid === user.uid) {
            event.target.reset();
            enterApp(user.uid, profile);
        }
    } catch (error) {
        authError.textContent = error.code === 'auth/operation-not-allowed'
            ? '匿名ログインが有効になっていません'
            : '参加できませんでした。もう一度お試しください';
    } finally {
        joining = false;
        authBtn.disabled = false;
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
    setAvatar(profileModalIcon, profile.name, profileIconUrl);
    profileModal.classList.add('active');
}

byId('profileIconInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    profileSaveBtn.disabled = true;
    try {
        profileIconUrl = await compressImage(file, 150, 0.8);
        setAvatar(profileModalIcon, profileModalName.value || '自分', profileIconUrl);
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

function renderMyProfileCard() {
    const profile = members.get(currentUserId);
    if (!profile) return;
    byId('memberMainTitle').textContent = `友だち (${profile.name})`;
    const card = listItem(profile.name, profile.iconUrl, profile.status && `💬 ${profile.status}`, openProfileModal);
    card.classList.add('my-profile-card');
    card.setAttribute('aria-label', `${profile.name}のプロフィール設定`);
    byId('myProfileCardContainer').replaceChildren(card);
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
        renderMyProfileCard();
        memberList.replaceChildren();
        for (const [friendId, friend] of friends()) {
            const item = listItem(friend.name, friend.iconUrl, friend.status && `💬 ${friend.status}`, async () => {
                requestNotificationPermission();
                item.disabled = true;
                try {
                    await openPrivateChat(friendId);
                } catch {
                    alert('トークを開けませんでした。');
                } finally {
                    item.disabled = false;
                }
            });
            memberList.appendChild(item);
        }
        if (createRoomModal.classList.contains('active')) renderGroupMemberOptions();
        renderRoomList();
        if (currentRoomId) {
            renderRoomTitle();
            if (groupDrawer.classList.contains('active')) renderDrawerMembers();
        }
    }, error => console.error('友だち一覧の取得に失敗しました。', error));
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
    createRoomModalIcon.textContent = '👥';
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
        setAvatar(createRoomModalIcon, '👥', roomIconUrl);
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

async function openPrivateChat(friendId) {
    const uid = currentUserId;
    const participantIds = [uid, friendId].sort();
    const roomId = participantIds.join('_');
    if (!rooms.has(roomId)) {
        const room = { kind: 'direct', members: participantIds };
        await setDoc(doc(db, 'rooms', roomId), room);
        if (uid !== currentUserId) return;
        if (!rooms.has(roomId)) rooms.set(roomId, room);
    }
    if (screens.member.classList.contains('active')) openRoom(roomId);
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

function roomDetails(roomId) {
    const room = rooms.get(roomId);
    const peer = room.kind === 'direct' ? members.get(room.members.find(uid => uid !== currentUserId)) : room;
    const localName = localStorage.getItem(`room_name_${roomId}`);
    return { name: localName || peer?.name || '個人トーク', iconUrl: peer?.iconUrl || '' };
}

function messageSummary(message) {
    if (message.type === 'image') return '[画像]';
    if (message.type === 'unsent') return '送信を取り消しました';
    return message.text;
}

function renderRoomList() {
    const entries = [...rooms.keys()].map(id => {
        const messages = roomFeeds.get(id)?.messages || [];
        const latest = messages.at(-1);
        const unread = messages.filter(message => message.type !== 'unsent' &&
            !message.readUsers.includes(currentUserId)).length;
        return { id, latest, unread };
    });
    entries.sort((first, second) => (second.latest?.timestamp.toMillis() || 0) - (first.latest?.timestamp.toMillis() || 0));
    roomList.replaceChildren();
    let totalUnread = 0;
    for (const { id, latest, unread } of entries) {
        const { name, iconUrl } = roomDetails(id);
        const preview = latest ? `${latest.senderName}: ${messageSummary(latest)}` : 'まだメッセージはありません';
        const item = listItem(name, iconUrl, preview, () => openRoom(id));
        if (unread) item.append(element('span', 'room-badge', unread));
        totalUnread += unread;
        roomList.append(item);
    }
    for (const tab of [byId('tabTalk'), byId('tabTalk2')]) {
        tab.querySelector('.tab-badge')?.remove();
        if (totalUnread) tab.append(element('span', 'tab-badge', totalUnread > 99 ? '99+' : totalUnread));
    }
}

const notificationBanner = element('div', 'notification-banner');
const notificationIcon = element('div', 'notification-icon');
const notificationTitle = element('div', 'notification-title');
const notificationText = element('div', 'notification-text');
const notificationInfo = element('div', 'notification-info');
const notificationClose = element('button', 'notification-close', '×');
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
    setAvatar(notificationIcon, message.senderName, message.senderIconUrl);
    const title = rooms.get(roomId).kind === 'group'
        ? `${roomDetails(roomId).name} - ${message.senderName}`
        : message.senderName;
    const body = messageSummary(message);
    notificationTitle.textContent = title;
    notificationText.textContent = body;
    notificationBanner.classList.add('active');
    clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(() => notificationBanner.classList.remove('active'), 4000);

    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            const notification = new Notification(title, { body, icon: message.senderIconUrl || 'icon.png', tag: roomId });
            notification.onclick = () => {
                window.focus();
                if (rooms.has(roomId)) openRoom(roomId);
                notification.close();
            };
        } catch {
            // OS 通知が使えないブラウザでもアプリ内通知を表示する。
        }
    }
}

function renderRoomTitle() {
    const { name, iconUrl } = roomDetails(currentRoomId);
    chatTitle.replaceChildren();
    if (iconUrl) appendImage(chatTitle, iconUrl, '');
    chatTitle.append(element('span', '', name));
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
}

function openRoom(roomId) {
    if (!rooms.has(roomId)) return;
    if (currentRoomId === roomId) return;
    closeRoom();
    currentRoomId = roomId;
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
        setAvatar(icon, name, profile?.iconUrl);
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

const STICKERS = ['🐱', '🐶', '🐰', '🦊', '🐻', '🐼', '🐨', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦'];
for (const sticker of STICKERS) {
    const button = element('button', 'sticker-item', sticker);
    button.addEventListener('click', () => {
        stickerPicker.classList.remove('active');
        sendMessage('sticker', sticker);
    });
    stickerPicker.append(button);
}
byId('stickerBtn').addEventListener('click', () => stickerPicker.classList.toggle('active'));

async function sendMessage(type, text = '', imageUrl = '') {
    const uid = currentUserId;
    const roomId = currentRoomId;
    const profile = members.get(uid);
    if (!roomId || !profile || sendBtn.disabled) return;
    const replyId = replyToMessage?.id || '';
    sendBtn.disabled = true;
    try {
        await addDoc(collection(db, 'rooms', roomId, 'messages'), {
            senderId: uid, senderName: profile.name, senderIconUrl: profile.iconUrl,
            type, text, imageUrl, replyTo: replyId, timestamp: serverTimestamp(), readUsers: [uid]
        });
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
    sendBtn.textContent = '送信中';
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
        sendBtn.textContent = '送信';
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
        const backgroundColor = getComputedStyle(bubble).backgroundColor;
        bubble.animate([{ backgroundColor: '#fef08a', offset: 0 }, { backgroundColor: '#fef08a', offset: 0.8 }, { backgroundColor }], 1500);
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
    for (const message of feed.messages) {
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
        const bubble = element('div', message.type === 'sticker' ? 'bubble sticker-bubble' : 'bubble');
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
        } else {
            bubble.append(element('span', '', message.text));
        }
        bubble.addEventListener('click', () => openMessageActions(message));
        const time = message.timestamp.toDate();
        const status = element('div', 'status-area');
        if (isMe) {
            const readCount = message.readUsers.length - 1;
            if (readCount > 0) {
                status.append(element('span', 'read-status', rooms.get(roomId).kind === 'direct' ? '既読' : `既読 ${readCount}`));
            }
            row.append(bubble);
        } else {
            const avatar = element('div', 'chat-avatar');
            setAvatar(avatar, message.senderName, message.senderIconUrl);
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
    if (user?.isAnonymous) {
        authBtn.disabled = true;
        try {
            const profile = await getDocFromServer(doc(db, 'members', user.uid));
            if (profile.exists() && auth.currentUser?.uid === user.uid) enterApp(user.uid, profile.data());
        } catch (error) {
            if (error.code !== 'permission-denied') authError.textContent = '登録を確認できませんでした。';
        }
    }
    if (!joining) authBtn.disabled = false;
});
