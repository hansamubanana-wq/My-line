# my-line

## 概要

「通っている学校の名前（漢字）」と「教室のカーテンの色（8択・複数選択）」の2問に答え、名前を入れて参加するチャットPWAです。参加したメンバーは全員が「友だち」に表示されます。登録はブラウザーに残り、同じブラウザーでは次回からそのまま開けます。

## 主な機能

- 名前順の友だち一覧、1対1トーク、メンバーを選んで作るグループトーク
- 幅768px以上では、友だち・トーク一覧と開いているトークを左右に表示
- プロフィールの名前・一言・アイコン編集、端末ごとのトーク名変更
- テキスト、スタンプ、返信、既読・未読、送信取り消し、アナウンス
- Imgurによる画像送信。アップロードできないときは圧縮したJPEGをFirestoreに保存します。
- アプリ内通知、ブラウザーが対応している場合のOS通知、ホーム画面へのインストール

## 使用技術

HTML、CSS、JavaScript、Firebase Authentication（匿名認証）、Cloud Firestore、Firebase Security Rules、Service Worker、Web App Manifest、Imgur API。

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

## 運用

参加のたびに匿名認証の UID ごとに `attempts/{uid}` へ試行回数と答えを記録します。Firestore は `joins/{uid}` の答えが記録済みの `guess` と一致するときだけハッシュを判定するため、1回の記録で試せる答えは1種類です。3回目の `lockedUntil` には Firestore のサーバー時刻を保存し、その時刻から1時間は新しい答えを記録できません。3回目でも正解なら参加でき、ロック解除後の次の試行は1回目になります。ページを開き直してもサーバーの記録を読み、解除時刻を表示します。

ブラウザのデータを消すと匿名認証の UID が変わり、別人扱いになって回数も戻ります（端末単位のロック）。

## ディレクトリ構成

```text
.
├── index.html       画面とOGP設定
├── style.css        画面のスタイル
├── app.js           匿名参加、友だち、トーク、通知
├── sw.js            アプリのキャッシュ
├── manifest.json    PWA設定と192pxアイコン
├── icon.png         512pxアプリアイコン兼OGP画像
├── firestore.rules  Firestoreのアクセス制御
├── firebase.json    Firebase CLIのルール設定
└── README.md        セットアップと運用方法
```

## 今後の改善案

- トーク履歴のページ分割と、メッセージが増えた際の未読集計の効率化
- 管理者による参加解除、アプリを閉じている間のプッシュ通知
