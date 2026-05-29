import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, arrayUnion, where, setDoc, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

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

let currentUserId = null;
let currentUserName = "";
let currentUserIconUrl = "";
let currentUserStatus = ""; // ステータスメッセージ (一言)
let currentRoomId = "global_group"; 
let isSignUpMode = false; // ログインか新規登録かの切り替えフラグ

let unsubscribeChat = null;
let allMessages = []; 

// プレミアム機能用変数
let replyToMessage = null; // { id, userName, messageText }
let activeAnnouncementUnsubscribe = null;
let selectedMessageForAction = null; // { id, userId, userName, messageText, elementId }

// キャッシュオブジェクト（リアルタイム同期用）
let roomsCache = {}; // { roomId: { name, iconUrl } }
let usersCache = {}; // { uid: { name, iconUrl } }

// 通知用変数
let isInitialLoad = true;
let bannerTimeout = null;

// 画像の圧縮とBase64変換のユーティリティ関数
function compressAndConvertToBase64(file, maxWidth = 800, maxHeight = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(dataUrl);
            };
            img.src = e.target.result;
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
} 

// 各種画面要素
const screens = {
    auth: document.getElementById('authScreen'),
    member: document.getElementById('memberScreen'),
    list: document.getElementById('listScreen'),
    room: document.getElementById('roomScreen')
};

const authTitle = document.getElementById('authTitle');
const authName = document.getElementById('authName');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authBtn = document.getElementById('authBtn');
const authToggle = document.getElementById('authToggle');

const memberList = document.getElementById('memberList');
const roomList = document.getElementById('roomList');
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const roomInput = document.getElementById('roomInput');
const saveRoomBtn = document.getElementById('saveRoomBtn');
const imageInput = document.getElementById('imageInput');
const chatTitle = document.getElementById('chatTitle');
const backBtn = document.getElementById('backBtn');
const menuBtn = document.getElementById('menuBtn');
const memberMainTitle = document.getElementById('memberMainTitle');
const googleAuthBtn = document.getElementById('googleAuthBtn');

const stickerBtn = document.getElementById('stickerBtn');
const stickerPicker = document.getElementById('stickerPicker');
const replyPreviewBox = document.getElementById('replyPreviewBox');
const replyPreviewText = document.getElementById('replyPreviewText');
const cancelReplyBtn = document.getElementById('cancelReplyBtn');

const messageActionModal = document.getElementById('messageActionModal');
const actionReplyBtn = document.getElementById('actionReplyBtn');
const actionAnnounceBtn = document.getElementById('actionAnnounceBtn');
const actionUnsendBtn = document.getElementById('actionUnsendBtn');
const actionCloseBtn = document.getElementById('actionCloseBtn');

const STICKERS = ["🐱", "🐶", "🐰", "🦊", "🐻", "🐼", "🐨", "🐱", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦"];

// スタンプ選択パネルの初期化
STICKERS.forEach(sticker => {
    const btn = document.createElement('button');
    btn.className = 'sticker-item';
    btn.textContent = sticker;
    btn.addEventListener('click', () => {
        sendSticker(sticker);
        stickerPicker.classList.remove('active');
    });
    stickerPicker.appendChild(btn);
});

// スタンプボタンのトグル挙動
if (stickerBtn && stickerPicker) {
    stickerBtn.addEventListener('click', () => {
        stickerPicker.classList.toggle('active');
    });
}

function setScreenSize() {
    let vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
}
window.addEventListener('resize', setScreenSize);
window.addEventListener('orientationchange', setScreenSize);
setScreenSize();

// インアプリ通知バナーの動的生成
const chatContainer = document.querySelector('.chat-container');
const notificationBanner = document.createElement('div');
notificationBanner.id = 'notificationBanner';
notificationBanner.className = 'notification-banner';
notificationBanner.innerHTML = `
    <div class="notification-icon" id="notiIcon">👤</div>
    <div class="notification-info">
        <div class="notification-title" id="notiTitle">新着メッセージ</div>
        <div class="notification-text" id="notiText">メッセージがあります</div>
    </div>
    <button class="notification-close" id="notiCloseBtn">×</button>
`;
chatContainer.appendChild(notificationBanner);

// 画面切り替え関数
function showScreen(screenKey) {
    Object.keys(screens).forEach(key => {
        if(key === screenKey) screens[key].classList.add('active');
        else screens[key].classList.remove('active');
    });
}

// LINE風タブバーのイベント
document.getElementById('tabTalk').addEventListener('click', () => showScreen('list'));
document.getElementById('tabMember2').addEventListener('click', () => showScreen('member'));

// --- 認証（ログイン・新規登録）まわりの処理 ---
authToggle.addEventListener('click', () => {
    isSignUpMode = !isSignUpMode;
    if(isSignUpMode) {
        authTitle.textContent = "新規登録";
        authName.style.display = "block";
        authBtn.textContent = "登録して始める";
        authToggle.textContent = "すでにアカウントをお持ちの場合はログイン";
    } else {
        authTitle.textContent = "ログイン";
        authName.style.display = "none";
        authBtn.textContent = "ログインする";
        authToggle.textContent = "アカウントを持っていない場合は新規登録";
    }
});

authBtn.addEventListener('click', async () => {
    const email = authEmail.value.trim();
    const password = authPassword.value;
    const name = authName.value.trim();

    if(!email || !password) { alert("メールアドレスとパスワードを入力してね！"); return; }

    if(isSignUpMode) {
        if(!name) { alert("お名前を入力してください！"); return; }
        try {
            const res = await createUserWithEmailAndPassword(auth, email, password);
            await setDoc(doc(db, "users", res.user.uid), {
                uid: res.user.uid,
                name: name,
                email: email
            });
            alert("新しくアカウントを作ったよ！");
        } catch(err) { alert("登録エラー: " + err.message); }
    } else {
        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch(err) { alert("ログインエラー: " + err.message); }
    }
});

// Googleログイン処理
googleAuthBtn.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if(!userDoc.exists()) {
            await setDoc(userDocRef, {
                uid: user.uid,
                name: user.displayName || "Googleユーザー",
                email: user.email
            });
        }
    } catch(err) {
        alert("Googleログインエラー: " + err.message);
    }
});

// ログアウト処理
const logout = () => { signOut(auth); localStorage.clear(); location.reload(); };
document.getElementById('logoutBtn1').addEventListener('click', logout);
document.getElementById('logoutBtn2').addEventListener('click', logout);

// --- プロフィール編集モーダルの処理 ---
const profileModal = document.getElementById('profileModal');
const profileModalName = document.getElementById('profileModalName');
const profileModalIcon = document.getElementById('profileModalIcon');
const profileIconInput = document.getElementById('profileIconInput');
const profileSaveBtn = document.getElementById('profileSaveBtn');
const profileCloseBtn = document.getElementById('profileCloseBtn');

let tempProfileIconBase64 = "";
const profileModalStatus = document.getElementById('profileModalStatus');

function openProfileModal() {
    profileModalName.value = currentUserName || "";
    profileModalStatus.value = currentUserStatus || "";
    tempProfileIconBase64 = currentUserIconUrl || "";
    
    updateProfileModalPreview(tempProfileIconBase64);
    
    const isNameInvalid = !currentUserName || currentUserName === "名無しさん" || currentUserName === "Googleユーザー" || currentUserName.trim() === "";
    if (isNameInvalid) {
        profileCloseBtn.style.display = "none";
    } else {
        profileCloseBtn.style.display = "block";
    }
    
    profileModal.classList.add('active');
}

function updateProfileModalPreview(url) {
    if (url) {
        profileModalIcon.innerHTML = `<img src="${url}" alt="アバター">`;
    } else {
        const shortName = currentUserName ? currentUserName.substring(0, 2) : "自分";
        profileModalIcon.textContent = shortName;
    }
}

profileIconInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const compressedBase64 = await compressAndConvertToBase64(file, 150, 150, 0.8);
        tempProfileIconBase64 = compressedBase64;
        updateProfileModalPreview(compressedBase64);
    } catch (err) {
        alert("画像の読み込みに失敗しました。");
    }
});

profileSaveBtn.addEventListener('click', async () => {
    const newName = profileModalName.value.trim();
    const newStatus = profileModalStatus.value.trim();
    if (!newName || newName === "名無しさん" || newName === "Googleユーザー") {
        alert("有効なお名前を入力してください！");
        return;
    }
    
    profileSaveBtn.disabled = true;
    profileSaveBtn.textContent = "保存中...";
    
    try {
        const userDocRef = doc(db, "users", currentUserId);
        await setDoc(userDocRef, {
            uid: currentUserId,
            name: newName,
            email: auth.currentUser.email,
            iconUrl: tempProfileIconBase64,
            status: newStatus
        }, { merge: true });
        
        currentUserName = newName;
        currentUserIconUrl = tempProfileIconBase64;
        currentUserStatus = newStatus;
        
        memberMainTitle.textContent = `友だち (${currentUserName})`;
        renderMyProfileCard();
        profileModal.classList.remove('active');
        
        if (currentRoomId) {
            registerRoomMember(currentRoomId);
        }
    } catch (err) {
        alert("保存エラー: " + err.message);
    } finally { // ✕ 「finaly」のタイポを「finally」に修正！
        profileSaveBtn.disabled = false;
        profileSaveBtn.textContent = "保存";
    }
});

profileCloseBtn.addEventListener('click', () => {
    profileModal.classList.remove('active');
});

// --- グループ新規作成モーダルの処理 ---
const createRoomModal = document.getElementById('createRoomModal');
const createRoomModalName = document.getElementById('createRoomModalName');
const createRoomModalIcon = document.getElementById('createRoomModalIcon');
const createRoomIconInput = document.getElementById('createRoomIconInput');
const createRoomModalBtn = document.getElementById('createRoomModalBtn');
const createRoomCloseBtn = document.getElementById('createRoomCloseBtn');

let tempRoomIconBase64 = "";
let pendingRoomKeyword = ""; 

function openCreateRoomModal(keyword = "") {
    createRoomModalName.value = keyword;
    tempRoomIconBase64 = "";
    pendingRoomKeyword = keyword.trim();
    createRoomModalIcon.textContent = "👥";
    createRoomModal.classList.add('active');
}

createRoomIconInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const compressedBase64 = await compressAndConvertToBase64(file, 150, 150, 0.8);
        tempRoomIconBase64 = compressedBase64;
        createRoomModalIcon.innerHTML = `<img src="${compressedBase64}" alt="グループアイコン">`;
    } catch (err) {
        alert("画像の読み込みに失敗しました。");
    }
});

createRoomModalBtn.addEventListener('click', async () => {
    const name = createRoomModalName.value.trim();
    if (!name) {
        alert("グループ名を入力してください！");
        return;
    }
    if (!tempRoomIconBase64) {
        alert("グループアイコンを設定してください！");
        return;
    }
    
    createRoomModalBtn.disabled = true;
    createRoomModalBtn.textContent = "作成中...";
    
    try {
        let roomId = "";
        if (pendingRoomKeyword) {
            roomId = "custom_" + pendingRoomKeyword;
        } else {
            const newRoomRef = doc(collection(db, "rooms"));
            roomId = "custom_" + newRoomRef.id;
        }
        
        await setDoc(doc(db, "rooms", roomId), {
            roomId: roomId,
            name: name,
            iconUrl: tempRoomIconBase64,
            createdBy: currentUserId,
            createdAt: serverTimestamp()
        });
        
        roomsCache[roomId] = {
            name: name,
            iconUrl: tempRoomIconBase64
        };
        
        openRoom(roomId, name);
        createRoomModal.classList.remove('active');
        roomInput.value = "";
    } catch (err) {
        alert("グループ作成エラー: " + err.message);
    } finally { // ✕ ここも修正
        createRoomModalBtn.disabled = false;
        createRoomModalBtn.textContent = "作成";
    }
});

createRoomCloseBtn.addEventListener('click', () => {
    createRoomModal.classList.remove('active');
});

function renderMyProfileCard() {
    const container = document.getElementById('myProfileCardContainer');
    if (!container) return;
    
    const shortName = currentUserName ? currentUserName.substring(0, 2) : "自分";
    const iconHtml = currentUserIconUrl 
        ? `<img src="${currentUserIconUrl}" alt="アイコン">`
        : shortName;
        
    const subText = currentUserStatus 
        ? `💬 ${currentUserStatus}` 
        : "タップしてプロフィール設定";
        
    container.innerHTML = `
        <div class="my-profile-card" id="myProfileCardBtn">
            <div class="item-icon">${iconHtml}</div>
            <div class="item-info">
                <div class="item-name">${currentUserName || "名前を設定してください"}</div>
                <div class="item-sub">${subText}</div>
            </div>
        </div>
    `;
    
    document.getElementById('myProfileCardBtn').addEventListener('click', () => {
        openProfileModal();
    });
}

let roomsListenerUnsubscribe = null;
function startRoomsListener() {
    if (roomsListenerUnsubscribe) roomsListenerUnsubscribe();
    
    roomsListenerUnsubscribe = onSnapshot(collection(db, "rooms"), (snapshot) => {
        snapshot.forEach((roomDoc) => {
            const rData = roomDoc.data();
            roomsCache[roomDoc.id] = {
                name: rData.name,
                iconUrl: rData.iconUrl
            };
        });
        renderRoomList(); 
    });
}

function getRoomDetails(roomId) {
    if (roomId === "global_group") {
        return { name: "グループチャット（全体）", iconUrl: "" };
    }
    if (roomsCache[roomId]) {
        return roomsCache[roomId];
    }
    const saved = localStorage.getItem(`room_name_${roomId}`);
    if (saved) return { name: saved, iconUrl: "" };
    
    if (roomId.startsWith("custom_")) {
        return { name: "グループ: " + roomId.replace("custom_", ""), iconUrl: "" };
    }
    return { name: "グループチャット", iconUrl: "" };
}

// 認証状態の監視
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserId = user.uid;
        const userDocRef = doc(db, "users", currentUserId);
        const userDoc = await getDoc(userDocRef);
        
        if(userDoc.exists()) {
            const uData = userDoc.data();
            currentUserName = uData.name || "";
            currentUserIconUrl = uData.iconUrl || "";
            currentUserStatus = uData.status || "";
        } else {
            currentUserName = user.displayName || "";
            currentUserIconUrl = user.photoURL || "";
            await setDoc(userDocRef, {
                uid: user.uid,
                name: currentUserName,
                email: user.email,
                iconUrl: currentUserIconUrl
            });
        }
        
        const isNameInvalid = !currentUserName || currentUserName === "名無しさん" || currentUserName === "Googleユーザー" || currentUserName.trim() === "";
        if (isNameInvalid) {
            openProfileModal();
        }

        memberMainTitle.textContent = `友だち (${currentUserName})`;
        renderMyProfileCard();
        showScreen('member');
        
        startGlobalListener(); 
        startMemberListListener(); 
        startRoomsListener(); 
        
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    } else {
        showScreen('auth');
        authName.style.display = "none";
    }
});

function startMemberListListener() {
    onSnapshot(collection(db, "users"), (snapshot) => {
        memberList.innerHTML = "";
        snapshot.forEach((userDoc) => {
            const uData = userDoc.data();
            usersCache[uData.uid] = {
                name: uData.name,
                iconUrl: uData.iconUrl || "",
                status: uData.status || ""
            };

            if(uData.uid === currentUserId) return; 

            const item = document.createElement('div');
            item.className = "list-item";
            const shortName = uData.name ? uData.name.substring(0, 2) : "友";
            const iconHtml = uData.iconUrl
                ? `<img src="${uData.iconUrl}" alt="アイコン">`
                : shortName;

            const statusHtml = uData.status 
                ? `<div style="font-size: 0.75rem; color: #53b63e; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px; margin-top: 2px;">💬 ${uData.status}</div>` 
                : "";

            item.innerHTML = `
                <div class="item-icon">${iconHtml}</div>
                <div class="item-info">
                    <div class="item-name">${uData.name}</div>
                    ${statusHtml}
                    <div class="item-sub" style="margin-top: 2px;">タップして個人トークを開く</div>
                </div>
            `;
            item.addEventListener('click', () => {
                openPrivateChat(uData.uid, uData.name);
            });
            memberList.appendChild(item);
        });
    });
}

saveRoomBtn.addEventListener('click', () => {
    const pw = roomInput.value.trim();
    if (pw === "") {
        openCreateRoomModal("");
        return;
    }
    
    const roomId = "custom_" + pw;
    if (roomsCache[roomId]) {
        openRoom(roomId, roomsCache[roomId].name);
        roomInput.value = "";
    } else {
        openCreateRoomModal(pw);
    }
});

async function sendMessage() {
    const text = chatInput.value.trim();
    if (text === "" || !currentUserId) return;

    try {
        const messageData = {
            roomId: currentRoomId,
            userId: currentUserId,
            userName: currentUserName,
            userIconUrl: currentUserIconUrl || "",
            messageText: text,
            type: "text",
            timestamp: serverTimestamp(),
            readUsers: [currentUserId]
        };

        if (replyToMessage) {
            messageData.replyTo = replyToMessage;
        }

        await addDoc(collection(db, "messages"), messageData);
        chatInput.value = "";

        replyToMessage = null;
        if (replyPreviewBox) replyPreviewBox.classList.remove('active');
    } catch (err) { alert("送信失敗: " + err.message); }
}
sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

async function sendSticker(sticker) {
    if (!currentUserId || !currentRoomId) return;
    try {
        await addDoc(collection(db, "messages"), {
            roomId: currentRoomId,
            userId: currentUserId,
            userName: currentUserName,
            userIconUrl: currentUserIconUrl || "",
            messageText: sticker,
            type: "sticker",
            timestamp: serverTimestamp(),
            readUsers: [currentUserId]
        });
    } catch (err) {
        console.error("スタンプ送信エラー:", err);
    }
}

imageInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !currentUserId) return;

    sendBtn.disabled = true;
    sendBtn.textContent = "送信中";
    
    let imgUrl = "";

    const formData = new FormData();
    formData.append('image', file);
    try {
        const response = await fetch('https://api.imgur.com/3/image', {
            method: 'POST',
            headers: { Authorization: 'Client-ID 7f20108ecf661ff' }, 
            body: formData
        });
        const result = await response.json();
        if (result.success) {
            imgUrl = result.data.link;
        }
    } catch (err) {
        console.warn("Imgurへのアップロードが失敗しました。Base64での直接保存に切り替えます:", err);
    }

    if (!imgUrl) {
        try {
            imgUrl = await compressAndConvertToBase64(file, 800, 800, 0.7);
        } catch (compressErr) {
            alert("画像の圧縮に失敗しました。");
            sendBtn.disabled = false;
            sendBtn.textContent = "送信";
            imageInput.value = "";
            return;
        }
    }

    try {
        await addDoc(collection(db, "messages"), {
            roomId: currentRoomId,
            userId: currentUserId,
            userName: currentUserName,
            userIconUrl: currentUserIconUrl || "",
            imageUrl: imgUrl,
            type: "image",
            timestamp: serverTimestamp(),
            readUsers: [currentUserId]
        });
    } catch (err) {
        alert("画像送信エラー: " + err.message);
    } finally { // ✕ 「finaly」のタイポを「finally」に修正！
        imageInput.value = "";
        sendBtn.disabled = false;
        sendBtn.textContent = "送信";
    }
});

function openRoom(roomId, title) {
    currentRoomId = roomId;
    
    let iconUrl = "";
    let roomTitleName = title;
    if (roomId.startsWith("private_")) {
        const otherUserId = roomId.replace("private_", "").split("_").find(id => id !== currentUserId);
        const otherUser = usersCache[otherUserId];
        roomTitleName = otherUser ? otherUser.name : title;
        iconUrl = otherUser ? otherUser.iconUrl : "";
    } else {
        const details = getRoomDetails(roomId);
        roomTitleName = details.name;
        iconUrl = details.iconUrl;
    }
    
    const iconHtml = iconUrl 
        ? `<img src="${iconUrl}" style="width: 30px; height: 30px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255,255,255,0.4); margin-right: 4px;">`
        : "";
    
    chatTitle.innerHTML = `<div style="display: flex; align-items: center; justify-content: center; gap: 8px;">${iconHtml}<span>${roomTitleName}</span></div>`;
    
    showScreen('room');

    if (unsubscribeChat) unsubscribeChat();
    chatLog.innerHTML = "";
    startChatLiveUpdate();
    
    registerRoomMember(roomId);
    startAnnouncementListener(roomId);
}

backBtn.addEventListener('click', () => {
    showScreen('list');
    if (unsubscribeChat) unsubscribeChat();
    currentRoomId = "";
    renderRoomList();
    document.getElementById('groupDrawer').classList.remove('active');
    
    if (activeAnnouncementUnsubscribe) {
        activeAnnouncementUnsubscribe();
        activeAnnouncementUnsubscribe = null;
    }
    const announcementBar = document.getElementById('announcementBar');
    if (announcementBar) {
        announcementBar.classList.remove('active');
    }
});

function startAnnouncementListener(roomId) {
    if (activeAnnouncementUnsubscribe) activeAnnouncementUnsubscribe();
    
    const announcementBar = document.getElementById('announcementBar');
    const announcementText = document.getElementById('announcementText');
    if (!announcementBar || !announcementText) return;
    
    const announcementRef = doc(db, "rooms", roomId, "announcements", "active");
    
    activeAnnouncementUnsubscribe = onSnapshot(announcementRef, (docSnap) => {
        if (docSnap.exists() && docSnap.data().messageId) {
            const data = docSnap.data();
            announcementText.textContent = data.text;
            announcementBar.classList.add('active');
            
            announcementBar.onclick = (e) => {
                if (e.target.id === 'closeAnnounceBtn') return; 
                
                const targetElement = document.getElementById(`msg_${data.messageId}`);
                if (targetElement) {
                    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    const bubble = targetElement.querySelector('.bubble');
                    if (bubble) {
                        bubble.style.transition = "background-color 0.3s ease";
                        const originalBg = bubble.style.backgroundColor;
                        bubble.style.backgroundColor = "#fef08a"; 
                        setTimeout(() => {
                            bubble.style.backgroundColor = originalBg;
                        }, 1500);
                    }
                } else {
                    alert("該当のメッセージが見つかりません（過去ログに埋もれているか、削除されています）");
                }
            };
        } else {
            announcementBar.classList.remove('active');
        }
    });
}

const closeAnnounceBtn = document.getElementById('closeAnnounceBtn');
if (closeAnnounceBtn) {
    closeAnnounceBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); 
        if (!currentRoomId) return;
        try {
            const announcementRef = doc(db, "rooms", currentRoomId, "announcements", "active");
            await deleteDoc(announcementRef);
        } catch (err) {
            console.error("アナウンス解除エラー:", err);
        }
    });
}

// メッセージ操作モーダル周りの挙動
function openMessageActionModal(messageId, userId, userName, messageText, elementId) {
    selectedMessageForAction = { id: messageId, userId, userName, messageText, elementId };
    
    if (userId === currentUserId) {
        actionUnsendBtn.style.display = "block";
    } else {
        actionUnsendBtn.style.display = "none";
    }
    
    messageActionModal.classList.add('active');
}

function closeMessageActionModal() {
    messageActionModal.classList.remove('active');
    selectedMessageForAction = null;
}

if (actionCloseBtn) {
    actionCloseBtn.addEventListener('click', closeMessageActionModal);
}

if (actionUnsendBtn) {
    actionUnsendBtn.addEventListener('click', async () => {
        if (!selectedMessageForAction) return;
        const msgId = selectedMessageForAction.id;
        try {
            const docRef = doc(db, "messages", msgId);
            await updateDoc(docRef, {
                type: "unsent",
                messageText: "送信取り消しされました"
            });
            closeMessageActionModal();
        } catch (err) {
            alert("送信取り消しに失敗しました: " + err.message);
        }
    });
}

if (actionAnnounceBtn) {
    actionAnnounceBtn.addEventListener('click', async () => {
        if (!selectedMessageForAction || !currentRoomId) return;
        const msgId = selectedMessageForAction.id;
        const senderName = selectedMessageForAction.userName;
        const text = selectedMessageForAction.messageText;
        
        try {
            const announcementRef = doc(db, "rooms", currentRoomId, "announcements", "active");
            await setDoc(announcementRef, {
                text: `${senderName}: ${text}`,
                messageId: msgId,
                pinnedBy: currentUserName,
                pinnedAt: serverTimestamp()
            });
            closeMessageActionModal();
        } catch (err) {
            alert("アナウンスの設定に失敗しました: " + err.message);
        }
    });
}

if (actionReplyBtn) {
    actionReplyBtn.addEventListener('click', () => {
        if (!selectedMessageForAction) return;
        
        replyToMessage = {
            id: selectedMessageForAction.id,
            userName: selectedMessageForAction.userName,
            messageText: selectedMessageForAction.messageText
        };
        
        if (replyPreviewText) {
            replyPreviewText.textContent = `${selectedMessageForAction.userName}さんへのリプライ: ${selectedMessageForAction.messageText}`;
        }
        if (replyPreviewBox) {
            replyPreviewBox.classList.add('active');
        }
        
        closeMessageActionModal();
        chatInput.focus();
    });
}

if (cancelReplyBtn) {
    cancelReplyBtn.addEventListener('click', () => {
        replyToMessage = null;
        if (replyPreviewBox) {
            replyPreviewBox.classList.remove('active');
        }
    });
}

function openPrivateChat(targetUserId, targetUserName) {
    if (targetUserId === currentUserId) return;
    const sortedIds = [currentUserId, targetUserId].sort();
    const privateRoomId = `private_${sortedIds[0]}_${sortedIds[1]}`;
    
    const privateTitle = getSavedRoomName(privateRoomId) || targetUserName;
    openRoom(privateRoomId, privateTitle);
}

async function registerRoomMember(roomId) {
    if (!currentUserId || !currentUserName) return;
    try {
        const memberRef = doc(db, "rooms", roomId, "members", currentUserId);
        await setDoc(memberRef, {
            uid: currentUserId,
            name: currentUserName,
            iconUrl: currentUserIconUrl || "",
            lastActive: serverTimestamp()
        });
    } catch (err) {
        console.error("メンバー登録エラー:", err);
    }
}

let unsubscribeDrawer = null;
function openGroupDrawer() {
    const drawer = document.getElementById('groupDrawer');
    const memberListEl = document.getElementById('drawerMemberList');
    const memberCountEl = document.getElementById('drawerMemberCount');
    const nameInput = document.getElementById('drawerRoomNameInput');
    
    nameInput.value = chatTitle.textContent;
    drawer.classList.add('active');
    
    if (unsubscribeDrawer) unsubscribeDrawer();
    
    const membersRef = collection(db, "rooms", currentRoomId, "members");
    unsubscribeDrawer = onSnapshot(membersRef, (snapshot) => {
        memberListEl.innerHTML = "";
        memberCountEl.textContent = `メンバー (${snapshot.size})`;
        
        snapshot.forEach((memberDoc) => {
            const mData = memberDoc.data();
            const shortName = mData.name ? mData.name.substring(0, 2) : "他";
            const iconHtml = mData.iconUrl 
                ? `<img src="${mData.iconUrl}" alt="アイコン">`
                : shortName;
                
            const item = document.createElement('div');
            item.className = "drawer-member-item";
            item.innerHTML = `
                <div class="drawer-member-icon">${iconHtml}</div>
                <div class="drawer-member-name">${mData.name}</div>
            `;
            memberListEl.appendChild(item);
        });
    });
}

menuBtn.addEventListener('click', openGroupDrawer);

document.getElementById('closeDrawerBtn').addEventListener('click', () => {
    document.getElementById('groupDrawer').classList.remove('active');
    if (unsubscribeDrawer) { unsubscribeDrawer(); unsubscribeDrawer = null; }
});

document.getElementById('drawerRoomNameSaveBtn').addEventListener('click', () => {
    const newName = document.getElementById('drawerRoomNameInput').value.trim();
    if (newName !== "") {
        localStorage.setItem(`room_name_${currentRoomId}`, newName);
        chatTitle.textContent = newName;
        document.getElementById('groupDrawer').classList.remove('active');
        if (unsubscribeDrawer) { unsubscribeDrawer(); unsubscribeDrawer = null; }
        renderRoomList();
    }
});

function getSavedRoomName(roomId) { return localStorage.getItem(`room_name_${roomId}`); }

// 5. グローバルメッセージ監視
function startGlobalListener() {
    const qAll = query(collection(db, "messages"), orderBy("timestamp", "desc"));
    onSnapshot(qAll, (snapshot) => {
        let newMessagesToNotify = [];
        
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const msg = { id: change.doc.id, ...change.doc.data() };
                if (!isInitialLoad) {
                    if (msg.userId !== currentUserId && msg.roomId !== currentRoomId) {
                        
                        let isForMe = false;

                        if (msg.roomId === "global_group") {
                            isForMe = true;
                        } else if (msg.roomId.startsWith("custom_")) {
                            if (roomsCache[msg.roomId]) {
                                isForMe = true;
                            }
                        } else if (msg.roomId.startsWith("private_")) {
                            if (currentUserId && msg.roomId.includes(currentUserId)) {
                                isForMe = true;
                            }
                        }

                        if (isForMe) {
                            newMessagesToNotify.push(msg);
                        }
                    }
                }
            }
        });
        
        if (isInitialLoad && snapshot.size > 0) {
            isInitialLoad = false;
        }
        
        if (newMessagesToNotify.length > 0) {
            newMessagesToNotify.sort((a, b) => {
                const timeA = a.timestamp ? a.timestamp.toDate().getTime() : 0;
                const timeB = b.timestamp ? b.timestamp.toDate().getTime() : 0;
                return timeB - timeA;
            });
            showInAppNotification(newMessagesToNotify[0]);
        }

        allMessages = [];
        snapshot.forEach(doc => { allMessages.push({ id: doc.id, ...doc.data() }); });
        renderRoomList(); 
        updateTabBadges(); 
    });
}

function showInAppNotification(msg) {
    const banner = document.getElementById('notificationBanner');
    const notiIcon = document.getElementById('notiIcon');
    const notiTitle = document.getElementById('notiTitle');
    const notiText = document.getElementById('notiText');
    
    const senderName = msg.userName || "誰か";
    const shortName = senderName.substring(0, 2);
    
    if (msg.userIconUrl) {
        notiIcon.innerHTML = `<img src="${msg.userIconUrl}" alt="アバター">`;
    } else {
        notiIcon.textContent = shortName;
        notiIcon.style.background = "linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)";
    }
    
    let titleText = senderName;
    if (msg.roomId === "global_group") {
        titleText = `全体チャット - ${senderName}`;
    } else if (msg.roomId.startsWith("custom_")) {
        const details = getRoomDetails(msg.roomId);
        titleText = `${details.name} - ${senderName}`;
    } else if (msg.roomId.startsWith("private_")) {
        titleText = `個人トーク - ${senderName}`;
    }
    
    const messageContent = msg.type === "image" ? "[画像が送信されました]" : msg.messageText;
    
    notiTitle.textContent = titleText;
    notiText.textContent = messageContent;
    
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
            const systemNoti = new Notification(titleText, {
                body: messageContent,
                icon: msg.userIconUrl || 'https://www.gstatic.com/images/branding/product/2x/avatar_square_blue_120dp.png', 
                tag: msg.roomId, 
                renotify: true   
            });
            
            systemNoti.onclick = () => {
                window.focus();
                let roomTitle = "トーク";
                if (msg.roomId === "global_group") {
                    roomTitle = "グループチャット（全体）";
                } else if (msg.roomId.startsWith("custom_")) {
                    const details = getRoomDetails(msg.roomId);
                    roomTitle = details.name;
                } else if (msg.roomId.startsWith("private_")) {
                    roomTitle = senderName;
                }
                openRoom(msg.roomId, roomTitle);
                systemNoti.close();
            };
        } catch (e) {
            console.error("OS標準通知の送信に失敗しました:", e);
        }
    }
    
    const newBanner = banner.cloneNode(true);
    banner.parentNode.replaceChild(newBanner, banner);
    
    newBanner.addEventListener('click', (e) => {
        if (e.target.id === 'notiCloseBtn') return;
        
        let roomTitle = "トーク";
        if (msg.roomId === "global_group") {
            roomTitle = "グループチャット（全体）";
        } else if (msg.roomId.startsWith("custom_")) {
            const details = getRoomDetails(msg.roomId);
            roomTitle = details.name;
        } else if (msg.roomId.startsWith("private_")) {
            roomTitle = senderName;
        }
        openRoom(msg.roomId, roomTitle);
        newBanner.classList.remove('active');
    });
    
    newBanner.querySelector('#notiCloseBtn').addEventListener('click', () => {
        newBanner.classList.remove('active');
    });
    
    newBanner.classList.add('active');
    
    if (bannerTimeout) clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(() => {
        newBanner.classList.remove('active');
    }, 4000);
}

function updateTabBadges() {
    let totalUnread = 0;
    const roomsUnread = {};
    
    allMessages.forEach(msg => {
        if (!msg.timestamp) return;
        let rId = msg.roomId || "global_group";
        let isForMe = false;
        
        if (rId === "global_group") {
            isForMe = true;
        } else if (rId.startsWith("custom_")) {
            isForMe = true;
        } else if (currentUserId && currentUserId !== "null" && currentUserId !== "undefined" && rId.startsWith("private_") && rId.includes(currentUserId)) {
            isForMe = true;
        }
        
        if (isForMe) {
            if (roomsUnread[rId] === undefined) roomsUnread[rId] = 0;
            if (msg.userId !== currentUserId && (!msg.readUsers || !msg.readUsers.includes(currentUserId))) {
                roomsUnread[rId]++;
            }
        }
    });
    
    Object.keys(roomsUnread).forEach(rId => {
        totalUnread += roomsUnread[rId];
    });
    
    const tabTalk = document.getElementById('tabTalk');
    const tabTalk2 = document.getElementById('tabTalk2');
    if (!tabTalk || !tabTalk2) return;
    
    const existingBadge1 = tabTalk.querySelector('.tab-badge');
    if (existingBadge1) existingBadge1.remove();
    const existingBadge2 = tabTalk2.querySelector('.tab-badge');
    if (existingBadge2) existingBadge2.remove();
    
    if (totalUnread > 0) {
        const badgeSpan1 = document.createElement('span');
        badgeSpan1.className = 'tab-badge';
        badgeSpan1.textContent = totalUnread > 99 ? '99+' : totalUnread;
        tabTalk.appendChild(badgeSpan1);
        
        const badgeSpan2 = document.createElement('span');
        badgeSpan2.className = 'tab-badge';
        badgeSpan2.textContent = totalUnread > 99 ? '99+' : totalUnread;
        tabTalk2.appendChild(badgeSpan2);
    }
}

function renderRoomList() {
    roomList.innerHTML = "";
    const roomsData = {};
    
    const globalDetails = getRoomDetails("global_group");
    roomsData["global_group"] = { 
        name: globalDetails.name, 
        iconUrl: globalDetails.iconUrl,
        lastMsg: "まだメッセージはありません", 
        unread: 0, 
        timestamp: 0 
    };

    allMessages.forEach(msg => {
        if (!msg.timestamp) return;
        let rId = msg.roomId || "global_group";
        let isForMe = false;

        if (rId === "global_group") {
            isForMe = true;
        } else if (rId.startsWith("custom_")) {
            isForMe = true;
        } else if (currentUserId && currentUserId !== "null" && currentUserId !== "undefined" && rId.startsWith("private_") && rId.includes(currentUserId)) {
            isForMe = true;
        }

        if (isForMe) {
            let roomName = "";
            let roomIcon = "";
            
            if (rId.startsWith("private_")) {
                const otherUserId = rId.replace("private_", "").split("_").find(id => id !== currentUserId);
                const otherUser = usersCache[otherUserId];
                roomName = otherUser ? otherUser.name : "個人トーク";
                roomIcon = otherUser ? otherUser.iconUrl : "";
            } else {
                const details = getRoomDetails(rId);
                roomName = details.name;
                roomIcon = details.iconUrl;
            }

            if (!roomsData[rId]) { 
                roomsData[rId] = { name: roomName, iconUrl: roomIcon, lastMsg: "", unread: 0, timestamp: 0 }; 
            } else {
                roomsData[rId].name = roomName;
                roomsData[rId].iconUrl = roomIcon;
            }

            if (roomsData[rId].timestamp === 0) {
                roomsData[rId].lastMsg = msg.type === "image" ? "[画像]" : `${msg.userName}: ${msg.messageText}`;
                roomsData[rId].timestamp = msg.timestamp.toDate().getTime();
            }
            if (currentUserId && currentUserId !== "null" && currentUserId !== "undefined" && msg.userId !== currentUserId && (!msg.readUsers || !msg.readUsers.includes(currentUserId))) {
                roomsData[rId].unread++;
            }
        }
    });

    const sortedRooms = Object.keys(roomsData).sort((a,b) => roomsData[b].timestamp - roomsData[a].timestamp);
    sortedRooms.forEach(roomId => {
        const room = roomsData[roomId];
        const item = document.createElement('div');
        item.className = "list-item";
        const shortName = room.name ? room.name.substring(0, 2) : "ト";
        const badgeHtml = room.unread > 0 ? `<span class="room-badge">${room.unread}</span>` : "";
        const iconHtml = room.iconUrl 
            ? `<img src="${room.iconUrl}" alt="アイコン">`
            : shortName;

        item.innerHTML = `
            <div class="item-icon">${iconHtml}</div>
            <div class="item-info">
                <div class="item-name">${room.name}</div>
                <div class="item-sub">${room.lastMsg}</div>
            </div>
            ${badgeHtml}
        `;
        item.addEventListener('click', () => { openRoom(roomId, room.name); });
        roomList.appendChild(item);
    });
}

function startChatLiveUpdate() {
    const q = query(collection(db, "messages"), where("roomId", "==", currentRoomId), orderBy("timestamp", "asc"));
    unsubscribeChat = onSnapshot(q, (snapshot) => {
        chatLog.innerHTML = "";
        snapshot.forEach((snapshotDoc) => {
            const data = snapshotDoc.data();
            if (!data.timestamp) return;

            const date = data.timestamp.toDate();
            const timeStr = date.getHours() + ":" + String(date.getMinutes()).padStart(2, '0');
            const isMe = data.userId === currentUserId;

            if (data.type === "unsent") {
                let systemMsgHtml = document.createElement('div');
                systemMsgHtml.className = "message unsent";
                systemMsgHtml.id = `msg_${snapshotDoc.id}`;
                systemMsgHtml.innerHTML = `
                    <div class="bubble">${data.userName}がメッセージの送信を取り消しました</div>
                `;
                chatLog.appendChild(systemMsgHtml);
                return;
            }

            const uniqueReadUsers = data.readUsers
                ? [...new Set(data.readUsers.filter(uid => uid && uid !== "null" && uid !== "undefined"))]
                : [];

            if (currentUserId && currentUserId !== "null" && currentUserId !== "undefined" && !isMe && !uniqueReadUsers.includes(currentUserId)) {
                const docRef = doc(db, "messages", snapshotDoc.id);
                updateDoc(docRef, { readUsers: arrayUnion(currentUserId) });
                if (!uniqueReadUsers.includes(currentUserId)) {
                    uniqueReadUsers.push(currentUserId);
                }
            }

            const hasSender = uniqueReadUsers.includes(data.userId);
            const readCount = hasSender ? uniqueReadUsers.length - 1 : uniqueReadUsers.length;
            const readText = readCount > 0 ? (currentRoomId.startsWith("private_") ? "既読" : `既読 ${readCount}`) : "";

            let replyQuoteHtml = "";
            if (data.replyTo) {
                replyQuoteHtml = `<div class="reply-quote-box" data-target-id="${data.replyTo.id}"><div style="font-weight: bold; font-size: 0.75rem; margin-bottom: 2px;">${data.replyTo.userName}</div><div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${data.replyTo.messageText}</div></div>`;
            }

            let contentHtml = "";
            let isSticker = data.type === "sticker";
            let bubbleClass = isSticker ? "bubble sticker-bubble" : "bubble";

            if (isSticker) {
                contentHtml = `<span>${data.messageText}</span>`;
            } else if (data.type === "image" || data.imageUrl) {
                contentHtml = `<img src="${data.imageUrl}" class="sent-image" alt="画像">`;
            } else { 
                contentHtml = `<div>${data.messageText}</div>`; 
            }

            let messageHtml = document.createElement('div');
            messageHtml.id = `msg_${snapshotDoc.id}`;
            if (isMe) {
                messageHtml.className = "message sent";
                messageHtml.innerHTML = `
                    <div class="${bubbleClass}">${replyQuoteHtml}${contentHtml}</div>
                    <div class="status-area">
                        <span class="read-status">${readText}</span>
                        <span class="time">${timeStr}</span>
                    </div>
                `;
            } else {
                messageHtml.className = "message received";
                const displayName = data.userName || "他";
                const shortName = displayName.substring(0, 2);
                const iconHtml = data.userIconUrl 
                    ? `<img src="${data.userIconUrl}" alt="アバター">`
                    : shortName;
                messageHtml.innerHTML = `
                    <div class="chat-avatar">${iconHtml}</div>
                    <div class="bubble-wrapper">
                        <span class="user-name-label">${displayName}</span>
                        <div class="${bubbleClass}">${replyQuoteHtml}${contentHtml}</div>
                    </div>
                    <div class="status-area"><span class="time">${timeStr}</span></div>
                `;
            }
            chatLog.appendChild(messageHtml);

            let bubbleEl = messageHtml.querySelector('.bubble');
            if (bubbleEl) {
                bubbleEl.style.cursor = "pointer";
                bubbleEl.addEventListener('click', () => {
                    openMessageActionModal(snapshotDoc.id, data.userId, data.userName, data.messageText || (data.type === "image" ? "[画像]" : "[スタンプ]"), messageHtml.id);
                });
            }

            let replyQuoteEl = messageHtml.querySelector('.reply-quote-box');
            if (replyQuoteEl) {
                replyQuoteEl.addEventListener('click', (e) => {
                    e.stopPropagation(); 
                    const targetId = replyQuoteEl.getAttribute('data-target-id');
                    const targetElement = document.getElementById(`msg_${targetId}`);
                    if (targetElement) {
                        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        const targetBubble = targetElement.querySelector('.bubble');
                        if (targetBubble) {
                            targetBubble.style.transition = "background-color 0.3s ease";
                            const originalBg = targetBubble.style.backgroundColor;
                            targetBubble.style.backgroundColor = "#fef08a"; 
                            setTimeout(() => {
                                targetBubble.style.backgroundColor = originalBg;
                            }, 1500);
                        }
                    } else {
                        alert("引用元のメッセージが見つかりません（過去ログに埋もれているか、削除されています）");
                    }
                });
            }
        });
        chatLog.scrollTop = chatLog.scrollHeight;
    });
}
