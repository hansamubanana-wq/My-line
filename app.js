import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, arrayUnion, where, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
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
let currentRoomId = "global_group"; 
let isSignUpMode = false; // ログインか新規登録かの切り替えフラグ

let unsubscribeChat = null;
let allMessages = []; 

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

function setScreenSize() {
    let vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
}
window.addEventListener('resize', setScreenSize);
window.addEventListener('orientationchange', setScreenSize);
setScreenSize();

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
            // 登録成功したら、Firestoreの「users」コレクションにユーザー情報を保存
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
        
        // ログイン成功したら、Firestoreの「users」コレクションにユーザー情報が存在するか確認
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if(!userDoc.exists()) {
            // Firestoreにまだ登録されていない場合は、Googleプロファイルの情報で作成
            await setDoc(userDocRef, {
                uid: user.uid,
                name: user.displayName || "Googleユーザー",
                email: user.email
            });
        }
        // 状態監視のonAuthStateChangedが自動で検知して画面を切り替えます
    } catch(err) {
        alert("Googleログインエラー: " + err.message);
    }
});

// ログアウト処理
const logout = () => { signOut(auth); localStorage.clear(); location.reload(); };
document.getElementById('logoutBtn1').addEventListener('click', logout);
document.getElementById('logoutBtn2').addEventListener('click', logout);

// 認証状態の監視
// --- プロフィール編集モーダルの処理 ---
const profileModal = document.getElementById('profileModal');
const profileModalName = document.getElementById('profileModalName');
const profileModalIcon = document.getElementById('profileModalIcon');
const profileIconInput = document.getElementById('profileIconInput');
const profileSaveBtn = document.getElementById('profileSaveBtn');
const profileCloseBtn = document.getElementById('profileCloseBtn');

let tempProfileIconBase64 = "";

function openProfileModal() {
    profileModalName.value = currentUserName || "";
    tempProfileIconBase64 = currentUserIconUrl || "";
    
    // アイコンのプレビュー更新
    updateProfileModalPreview(tempProfileIconBase64);
    
    // 名無しさん・Googleユーザーの場合は強制設定にするため閉じるボタンを隠す
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

// ファイル選択時の圧縮処理
profileIconInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
        // アイコン画像は150x150で充分高精細かつ軽量
        const compressedBase64 = await compressAndConvertToBase64(file, 150, 150, 0.8);
        tempProfileIconBase64 = compressedBase64;
        updateProfileModalPreview(compressedBase64);
    } catch (err) {
        alert("画像の読み込みに失敗しました。");
    }
});

// プロフィール保存
profileSaveBtn.addEventListener('click', async () => {
    const newName = profileModalName.value.trim();
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
            iconUrl: tempProfileIconBase64
        }, { merge: true });
        
        currentUserName = newName;
        currentUserIconUrl = tempProfileIconBase64;
        
        // 友達タイトルも更新
        memberMainTitle.textContent = `友だち (${currentUserName})`;
        
        // 自分カードの更新
        renderMyProfileCard();
        
        // プロフィールが正しく入力されたらモーダルを閉じる
        profileModal.classList.remove('active');
        
        // 各種トークの自分のメンバー情報も更新登録
        if (currentRoomId) {
            registerRoomMember(currentRoomId);
        }
    } catch (err) {
        alert("保存エラー: " + err.message);
    } finally {
        profileSaveBtn.disabled = false;
        profileSaveBtn.textContent = "保存";
    }
});

profileCloseBtn.addEventListener('click', () => {
    profileModal.classList.remove('active');
});

// 自分カードの描画関数
function renderMyProfileCard() {
    const container = document.getElementById('myProfileCardContainer');
    if (!container) return;
    
    const shortName = currentUserName ? currentUserName.substring(0, 2) : "自分";
    const iconHtml = currentUserIconUrl 
        ? `<img src="${currentUserIconUrl}" alt="アイコン">`
        : shortName;
        
    container.innerHTML = `
        <div class="my-profile-card" id="myProfileCardBtn">
            <div class="item-icon">${iconHtml}</div>
            <div class="item-info">
                <div class="item-name">${currentUserName || "名前を設定してください"}</div>
                <div class="item-sub">タップしてプロフィール設定</div>
            </div>
        </div>
    `;
    
    document.getElementById('myProfileCardBtn').addEventListener('click', () => {
        openProfileModal();
    });
}

// 認証状態の監視
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserId = user.uid;
        // データベースからログインした人の情報を取得
        const userDocRef = doc(db, "users", currentUserId);
        const userDoc = await getDoc(userDocRef);
        
        if(userDoc.exists()) {
            const uData = userDoc.data();
            currentUserName = uData.name || "";
            currentUserIconUrl = uData.iconUrl || "";
        } else {
            // GoogleログインなどでFirestoreドキュメントがまだない場合
            currentUserName = user.displayName || "";
            currentUserIconUrl = user.photoURL || "";
            // 初期データを保存
            await setDoc(userDocRef, {
                uid: currentUserId,
                name: currentUserName,
                email: user.email,
                iconUrl: currentUserIconUrl
            });
        }
        
        // もし名前が登録されていない、もしくはデフォルトの場合は強制プロフィール設定モーダルを表示
        const isNameInvalid = !currentUserName || currentUserName === "名無しさん" || currentUserName === "Googleユーザー" || currentUserName.trim() === "";
        if (isNameInvalid) {
            openProfileModal();
        }

        memberMainTitle.textContent = `友だち (${currentUserName})`;
        renderMyProfileCard();
        showScreen('member');
        
        startGlobalListener(); // メッセージ監視
        startMemberListListener(); // 参加者一覧監視
    } else {
        showScreen('auth');
        authName.style.display = "none";
    }
});

// ★新機能：参加メンバー（ユーザー）一覧を取得して描画する
function startMemberListListener() {
    onSnapshot(collection(db, "users"), (snapshot) => {
        memberList.innerHTML = "";
        snapshot.forEach((userDoc) => {
            const uData = userDoc.data();
            if(uData.uid === currentUserId) return; // 自分は一覧に出さない

            const item = document.createElement('div');
            item.className = "list-item";
            const shortName = uData.name ? uData.name.substring(0, 2) : "友";
            const iconHtml = uData.iconUrl
                ? `<img src="${uData.iconUrl}" alt="アイコン">`
                : shortName;

            item.innerHTML = `
                <div class="item-icon">${iconHtml}</div>
                <div class="item-info">
                    <div class="item-name">${uData.name}</div>
                    <div class="item-sub">タップして個人トークを開く</div>
                </div>
            `;
            // メンバーをタップしたら自動で個人トークを開始！
            item.addEventListener('click', () => {
                openPrivateChat(uData.uid, uData.name);
            });
            memberList.appendChild(item);
        });
    });
}

// 合言葉部屋の作成・参加
saveRoomBtn.addEventListener('click', () => {
    const pw = roomInput.value.trim();
    if (pw !== "") {
        roomInput.value = "";
        const customRoomId = "custom_" + pw;
        const customTitle = getSavedRoomName(customRoomId) || `グループ: ${pw}`;
        openRoom(customRoomId, customTitle);
    }
});

// 2. 文字送信
async function sendMessage() {
    const text = chatInput.value.trim();
    if (text === "" || !currentUserId) return;

    try {
        await addDoc(collection(db, "messages"), {
            roomId: currentRoomId,
            userId: currentUserId,
            userName: currentUserName,
            userIconUrl: currentUserIconUrl || "",
            messageText: text,
            type: "text",
            timestamp: serverTimestamp(),
            readUsers: [currentUserId]
        });
        chatInput.value = "";
    } catch (err) { alert("送信失敗: " + err.message); }
}
sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

// 3. 画像送信（Imgur連携 ＆ 頑丈なBase64ダイレクト自動フォールバック）
imageInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !currentUserId) return;

    sendBtn.disabled = true;
    sendBtn.textContent = "送信中";
    
    let imgUrl = "";

    // 1. まずはImgurへのアップロードを試みる
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

    // 2. Imgurが失敗した場合は、ローカルで軽量に圧縮してBase64文字列として直接Firestoreへ保存する
    if (!imgUrl) {
        try {
            // トーク画像は最大800x800で充分高精細かつ軽量化
            imgUrl = await compressAndConvertToBase64(file, 800, 800, 0.7);
        } catch (compressErr) {
            alert("画像の圧縮に失敗しました。");
            sendBtn.disabled = false;
            sendBtn.textContent = "送信";
            imageInput.value = "";
            return;
        }
    }

    // 3. 取得したURLまたはBase64でメッセージを送信
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
    } finally {
        imageInput.value = "";
        sendBtn.disabled = false;
        sendBtn.textContent = "送信";
    }
});

// 4. 部屋の移動
function openRoom(roomId, title) {
    currentRoomId = roomId;
    chatTitle.textContent = title;
    showScreen('room');

    if (unsubscribeChat) unsubscribeChat();
    chatLog.innerHTML = "";
    startChatLiveUpdate();
    
    // この部屋のメンバーとして自分を登録
    registerRoomMember(roomId);
}

backBtn.addEventListener('click', () => {
    showScreen('list');
    if (unsubscribeChat) unsubscribeChat();
    currentRoomId = "";
    renderRoomList();
    // ドロワーも閉じる
    document.getElementById('groupDrawer').classList.remove('active');
});

function openPrivateChat(targetUserId, targetUserName) {
    if (targetUserId === currentUserId) return;
    const sortedIds = [currentUserId, targetUserId].sort();
    const privateRoomId = `private_${sortedIds[0]}_${sortedIds[1]}`;
    
    const privateTitle = getSavedRoomName(privateRoomId) || targetUserName;
    openRoom(privateRoomId, privateTitle);
}

// 部屋のメンバー一覧に自分を登録する
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

// グループ設定（ドロワー）を開く処理
let unsubscribeDrawer = null;
function openGroupDrawer() {
    const drawer = document.getElementById('groupDrawer');
    const memberListEl = document.getElementById('drawerMemberList');
    const memberCountEl = document.getElementById('drawerMemberCount');
    const nameInput = document.getElementById('drawerRoomNameInput');
    
    nameInput.value = chatTitle.textContent;
    drawer.classList.add('active');
    
    if (unsubscribeDrawer) unsubscribeDrawer();
    
    // リアルタイムでその部屋のメンバー一覧を監視して描画
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

// ドロワーのイベント設定
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
        allMessages = [];
        snapshot.forEach(doc => { allMessages.push({ id: doc.id, ...doc.data() }); });
        renderRoomList(); 
    });
}

function renderRoomList() {
    roomList.innerHTML = "";
    const globalCustomName = getSavedRoomName("global_group") || "グループチャット（全体）";
    const roomsData = {};
    roomsData["global_group"] = { name: globalCustomName, lastMsg: "まだメッセージはありません", unread: 0, timestamp: 0 };

    allMessages.forEach(msg => {
        if (!msg.timestamp) return;
        let rId = msg.roomId || "global_group";
        let isForMe = false;
        let roomName = "";

        if (rId === "global_group") {
            isForMe = true;
            roomName = getSavedRoomName("global_group") || "グループチャット（全体）";
        } else if (rId.startsWith("custom_")) {
            isForMe = true;
            roomName = getSavedRoomName(rId) || "グループ: " + rId.replace("custom_", "");
        } else if (currentUserId && currentUserId !== "null" && currentUserId !== "undefined" && rId.startsWith("private_") && rId.includes(currentUserId)) {
            isForMe = true;
            const defaultName = msg.userId === currentUserId ? "個人トーク" : msg.userName;
            roomName = getSavedRoomName(rId) || defaultName;
        }

        if (isForMe) {
            if (!roomsData[rId]) { roomsData[rId] = { name: roomName, lastMsg: "", unread: 0, timestamp: 0 }; }
            const savedName = getSavedRoomName(rId);
            if (savedName) { roomsData[rId].name = savedName; }

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
        const shortName = room.name.substring(0, 2);
        const badgeHtml = room.unread > 0 ? `<span class="room-badge">${room.unread}</span>` : "";

        item.innerHTML = `
            <div class="item-icon">${shortName}</div>
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

// 6. トークルーム内のリアルタイム同期
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

            // 無効なユーザーID（nullやundefinedなど）を除外してユニークな既読ユーザーを計算
            const uniqueReadUsers = data.readUsers
                ? [...new Set(data.readUsers.filter(uid => uid && uid !== "null" && uid !== "undefined"))]
                : [];

            // ログイン済みかつ有効な自分のUIDがあり、自分が送信者ではない場合、かつ未読の場合は既読にする
            if (currentUserId && currentUserId !== "null" && currentUserId !== "undefined" && !isMe && !uniqueReadUsers.includes(currentUserId)) {
                const docRef = doc(db, "messages", snapshotDoc.id);
                updateDoc(docRef, { readUsers: arrayUnion(currentUserId) });
                // ローカルの計算用配列にも追加して、Firestoreからのリアルタイム反映を待たずに即時表示を正しくする
                if (!uniqueReadUsers.includes(currentUserId)) {
                    uniqueReadUsers.push(currentUserId);
                }
            }

            // 既読数の計算（送信者自身が含まれている場合は-1する）
            const hasSender = uniqueReadUsers.includes(data.userId);
            const readCount = hasSender ? uniqueReadUsers.length - 1 : uniqueReadUsers.length;
            const readText = readCount > 0 ? (currentRoomId.startsWith("private_") ? "既読" : `既読 ${readCount}`) : "";

            let contentHtml = "";
            if (data.type === "image" || data.imageUrl) {
                contentHtml = `<img src="${data.imageUrl}" class="sent-image" alt="画像">`;
            } else { contentHtml = data.messageText; }

            let messageHtml = document.createElement('div');
            if (isMe) {
                messageHtml.className = "message sent";
                messageHtml.innerHTML = `
                    <div class="bubble">${contentHtml}</div>
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
                        <div class="bubble">${contentHtml}</div>
                    </div>
                    <div class="status-area"><span class="time">${timeStr}</span></div>
                `;
            }
            chatLog.appendChild(messageHtml);
        });
        chatLog.scrollTop = chatLog.scrollHeight;
    });
}
