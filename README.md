# シリウスA（Discord AI秘書Bot）

Discord上で「秘書」「シリウス召喚」「!ai」または `/ai` をトリガーに、スマホでも押しやすいボタン付きメニューで機能実行できるBotです。

## セットアップ

1. `.env.example` を `.env` にコピーして必要な値を設定
2. 依存関係をインストール

```bash
npm install
```

## 起動

```bash
cd ~/Desktop/\(\(\(\)\)\)/BTJ/LUXE_WAVE/Claud/AI\ 秘書/discord-ai-secretary
npm install
node bot.js
```

起動成功時は以下が表示されます。

```text
🤖 シリウスAが起動しました。
🔌 GPT連携ブリッジを起動しました: http://localhost:3000
```

## スマホ対応ポイント

- メニューを **Embed + ボタンUI** で表示（タップ選択しやすい）
- 従来どおり数字入力でも選択可能
- `/ai` スラッシュコマンドにも対応

## GPTアプリ連動（カスタムGPT Actions）

このBotは、GPTアプリ（Custom GPT）のActionから叩けるHTTPブリッジを内蔵しています。

### 1) `.env` に以下を設定

- `GPT_BRIDGE_PORT=3000`
- `GPT_BRIDGE_BEARER_TOKEN=<十分長いランダム文字列>`
- `DEFAULT_NOTIFY_CHANNEL_ID=<Discordの通知先チャンネルID>`

### 2) 外部公開

スマホGPTアプリから呼び出すにはHTTPSで外部公開してください（例: Cloudflare Tunnel / ngrok）。

### 3) GPT Actionのエンドポイント

- `GET /health`
- `POST /gpt/command`
  - Header: `Authorization: Bearer <GPT_BRIDGE_BEARER_TOKEN>`
  - Body例:

```json
{
  "mode": "channel",
  "message": "今日の運用メモを投稿してください"
}
```

DM送信例:

```json
{
  "mode": "dm",
  "userId": "123456789012345678",
  "message": "リマインダーです"
}
```

## 環境変数

- `DISCORD_BOT_TOKEN`（必須）
- `DISCORD_APP_ID`（任意: スラッシュコマンド登録先の明示に使用）
- `OPENAI_API_KEY`（AI生成/PDF要約）
- `WEB_SEARCH_API_KEY`（Web検索要約。未設定時は準備中メッセージ）
- `NOTION_API_KEY`
- `NOTION_DATABASE_ID`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GPT_BRIDGE_PORT`（GPT連動用HTTPブリッジのポート）
- `GPT_BRIDGE_BEARER_TOKEN`（GPT連動API認証トークン）
- `DEFAULT_NOTIFY_CHANNEL_ID`（GPT連動時の既定投稿先）

未使用APIキーは空でも起動できます。
