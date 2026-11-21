# my-line

## 概要

「通っている学校の名前（漢字）」と「教室のカーテンの色（8択・複数選択）」の2問に答え、名前を入れて参加するチャットPWAです。参加したメンバーは「トーク」一覧に表示されます。登録はブラウザーに残り、同じブラウザーでは次回からそのまま開けます。

## 主な機能

- 「トーク」一覧には1対1・グループの履歴を最新順に表示し、未会話のメンバーをその下に名前順で表示
- 最新メッセージの抜粋・時刻・未読件数とメンバーの参加をリアルタイムに反映
- 一覧の見出しからプロフィール設定とグループ作成を開ける
- 幅768px以上では一覧と開いているトークを左右に表示し、選択中の行を強調
- プロフィールの名前・一言・アイコン編集、端末ごとのトーク名変更
- テキスト、返信、既読・未読、送信取り消し、アナウンス
- 左スワイプで返信
- 17種類の画像スタンプを3列のパネルから送信。トークでは幅768px未満で180px四方、2列表示で220px四方。送信済みの絵文字スタンプも引き続き表示
- Imgurによる画像送信。アップロードできないときは圧縮したJPEGをFirestoreに保存します。
- アプリ内通知、FCM Web Push によるアプリを閉じている間の通知、ホーム画面へのインストール

## 使用技術

HTML、CSS、JavaScript、Firebase Authentication（匿名認証）、Cloud Firestore、Firebase Security Rules、Firebase Cloud Messaging、Service Worker、Web App Manifest、Vercel Functions、Imgur API。

## 起動方法

1. Firebase コンソールで対象プロジェクトを開き、**Authentication → Sign-in method → 匿名**を有効にします。Cloud Firestore のデフォルトデータベースも作成します。別プロジェクトを使う場合は `app.js` の `firebaseConfig` をそのプロジェクトのWebアプリ設定に更新します。
2. 参加時の答えは `学校名|色,色` の形の文字列（学校名は NFKC 正規化して空白を除いたもの、色は画面の並び順でカンマ区切り）にまとめられ、その SHA-256 がルールの許可リストにあるかで判定します。別解（「〇〇高校」など）は許可リストにハッシュを並べて受け付けます。
3. 公開リポジトリの `firestore.rules` は許可リストが `REPLACE_WITH_SHA256_HEX` のままです。実際のハッシュを入れたルールは `firestore.rules.local`（Git 管理外）に置き、それを公開します。答えの候補が少ないため、ハッシュが公開されると総当たりで答えが分かってしまいます。ハッシュはリポジトリに入れないでください。
4. Firebase CLI の `firebase login` で認証し、次のコマンドでルールを公開します。Firebase コンソールの **Firestore Database → ルール** に差し替え済みの全文を貼り付けて公開することもできます。

   ```sh
   firebase deploy --only firestore:rules --project YOUR_PROJECT_ID
   ```

5. リポジトリで `python -m http.server 8000 --bind 127.0.0.1` を実行し、`http://localhost:8000/` を開きます。本番ではHTTPSで配信し、`index.html` の `og:image` を公開先の `icon.png` の絶対URLに変更します。

新しいルールでは `joins` と `members` で参加状態を管理し、トーク履歴は `rooms/{roomId}/messages` に保存します。既存のアカウントやトーク履歴は引き継ぎません。合言葉の変更後も、参加済みの端末は同じ匿名認証で利用できます。

### プッシュ通知の設定

1. Firebase コンソールの **プロジェクトの設定 → Cloud Messaging → ウェブ構成 → ウェブプッシュ証明書** で鍵ペアを生成し、公開鍵を `app.js` の `VAPID_PUBLIC_KEY` に設定します。空欄またはプレースホルダーの間は通知設定が表示されません。
2. 同じ Firebase プロジェクトの **プロジェクトの設定 → サービスアカウント → 新しい秘密鍵を生成** で取得した JSON の内容を、Vercel の **Settings → Environment Variables** で `FIREBASE_SERVICE_ACCOUNT` に設定します。鍵ファイルや秘密鍵の内容を Git に入れないでください。
3. 参加用ハッシュを設定した本番用ルールに、`firestore.rules` の `presence`、`pushTokens`、`notifySent` のルールを反映して公開します。
4. Vercel のフレームワークプリセットは **Other**、配信先はリポジトリのルート、ビルドコマンドは空欄です。`api/notify.js` は Node.js Function として動作します。依存関係のインストールは有効にします。通知送信には Vercel の Function が動く HTTPS 環境が必要です。
5. iOS・iPadOS 16.4 以降は、Safari からホーム画面に追加し、そのアイコンからアプリを開いて「通知をオンにする」を押します。Android・PC では対応ブラウザーで同じボタンを押します。

参加済みのアプリは前面になった直後と20秒ごとに在席を更新し、背面に移ると在席を解除します。
サーバーは在席時刻が45秒以内の受信者へのプッシュを省きます。前面では別のトークの新着だけを画面内の帯で知らせます。

## 運用

参加のたびに匿名認証の UID ごとに `attempts/{uid}` へ試行回数と答えを記録します。Firestore は `joins/{uid}` の答えが記録済みの `guess` と一致するときだけハッシュを判定するため、1回の記録で試せる答えは1種類です。3回目の `lockedUntil` には Firestore のサーバー時刻を保存し、その時刻から1時間は新しい答えを記録できません。3回目でも正解なら参加でき、ロック解除後の次の試行は1回目になります。ページを開き直してもサーバーの記録を読み、解除時刻を表示します。

ブラウザのデータを消すと匿名認証の UID が変わり、別人扱いになって回数も戻ります（端末単位のロック）。

## ディレクトリ構成

```text
.
├── index.html       画面とOGP設定
├── style.css        画面のスタイル
├── app.js           匿名参加、トーク一覧、トーク、通知
├── sw.js            アプリのキャッシュとプッシュ通知の受信
├── stickers/*.webp  画像スタンプ（320×320、透過WebP）
├── api/notify.js    Vercel Function によるプッシュ通知の送信
├── package.json     通知送信に使う Firebase Admin SDK の依存関係
├── manifest.json    PWA設定と192pxアイコン
├── icon.png         512pxアプリアイコン兼OGP画像
├── firestore.rules  Firestoreのアクセス制御
├── firebase.json    Firebase CLIのルール設定
└── README.md        セットアップと運用方法
```

## 今後の改善案

- トーク履歴のページ分割と、メッセージが増えた際の未読集計の効率化
- 管理者による参加解除
