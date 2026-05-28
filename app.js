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
let currentRoomId = "global_group"; 
let isSignUpMode = false; // ログインか新規登録かの切り替えフラグ

let unsubscribeChat = null;
let allMessages = []; 

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
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserId = user.uid;
        // データベースからログインした人の名前を取得
        const userDoc = await getDoc(doc(db, "users", currentUserId));
        if(userDoc.exists()) {
            currentUserName = userDoc.data().name;
        } else {
            currentUserName = "名無しさん";
        }
        memberMainTitle.textContent = `友だち (${currentUserName})`;
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
            const shortName = uData.name.substring(0, 2);

            item.innerHTML = `
                <div class="item-icon">${shortName}</div>
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

// 3. 無料の画像送信（Imgur連携）
imageInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !currentUserId) return;

    sendBtn.disabled = true;
    sendBtn.textContent = "送信中";
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
            const imgUrl = result.data.link; 
            await addDoc(collection(db, "messages"), {
                roomId: currentRoomId,
                userId: currentUserId,
                userName: currentUserName,
                imageUrl: imgUrl,
                type: "image",
                timestamp: serverTimestamp(),
                readUsers: [currentUserId]
            });
        } else { alert("画像の送信に失敗しました。"); }
    } catch (err) { alert("画像送信エラー: " + err.message); }
    finally { imageInput.value = ""; sendBtn.disabled = false; sendBtn.textContent = "送信"; }
});

// 4. 部屋の移動
function openRoom(roomId, title) {
    currentRoomId = roomId;
    chatTitle.textContent = title;
    showScreen('room');

    if (unsubscribeChat) unsubscribeChat();
    chatLog.innerHTML = "";
    startChatLiveUpdate();
}

backBtn.addEventListener('click', () => {
    showScreen('list');
    if (unsubscribeChat) unsubscribeChat();
    currentRoomId = "";
    renderRoomList();
});

function openPrivateChat(targetUserId, targetUserName) {
    if (targetUserId === currentUserId) return;
    const sortedIds = [currentUserId, targetUserId].sort();
    const privateRoomId = `private_${sortedIds[0]}_${sortedIds[1]}`;
    
    const privateTitle = getSavedRoomName(privateRoomId) || targetUserName;
    openRoom(privateRoomId, privateTitle);
}

// トーク表示名のカスタマイズ変更
menuBtn.addEventListener('click', () => {
    const currentTitle = chatTitle.textContent;
    const newTitle = prompt("このトークの表示名を入力してください：", currentTitle);
    if (newTitle !== null && newTitle.trim() !== "") {
        const cleanTitle = newTitle.trim();
        localStorage.setItem(`room_name_${currentRoomId}`, cleanTitle);
        chatTitle.textContent = cleanTitle;
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
                messageHtml.innerHTML = `
                    <div class="chat-avatar">${shortName}</div>
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
