require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse');
const express = require('express');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const userState = new Map();

const MENU_LINES = [
  '1. note記事（2000〜3000字）＋挿絵',
  '2. X投稿文＋画像',
  '3. Instagram投稿文＋画像',
  '4. Threads投稿文＋画像',
  '5. 画像のみ生成',
  '6. Web検索して要約',
  '7. 今日の予定を表示',
  '8. 明日の予定を表示',
  '9. 今後7日間の予定を表示',
  '10. タスクを追加',
  '11. 未完了タスクを一覧表示',
  '12. タスクを完了にする',
  '13. 指定時間後にDMで通知',
];

const STUB_MESSAGE = 'この機能は現在準備中です。Google Calendar / Notion API設定後に有効化できます。';


function requireBridgeAuth(req, res, next) {
  const requiredToken = process.env.GPT_BRIDGE_BEARER_TOKEN;
  if (!requiredToken) return res.status(503).json({ error: 'GPT_BRIDGE_BEARER_TOKEN is not configured' });
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${requiredToken}`) return res.status(401).json({ error: 'Unauthorized' });
  return next();
}

function startGptBridgeServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_, res) => res.json({ ok: true, service: 'sirius-a-bridge' }));

  app.post('/gpt/command', requireBridgeAuth, async (req, res) => {
    const { mode = 'channel', message, channelId, userId } = req.body || {};
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message is required' });

    try {
      if (mode === 'dm') {
        if (!userId) return res.status(400).json({ error: 'userId is required when mode=dm' });
        const user = await client.users.fetch(String(userId));
        await user.send(message);
        return res.json({ ok: true, delivered: 'dm', userId: String(userId) });
      }

      const targetChannelId = String(channelId || process.env.DEFAULT_NOTIFY_CHANNEL_ID || '');
      if (!targetChannelId) return res.status(400).json({ error: 'channelId or DEFAULT_NOTIFY_CHANNEL_ID is required' });
      const channel = await client.channels.fetch(targetChannelId);
      if (!channel || !channel.isTextBased()) return res.status(400).json({ error: 'target channel is not text based' });
      await sendLongMessage(channel, message);
      return res.json({ ok: true, delivered: 'channel', channelId: targetChannelId });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  const port = Number(process.env.GPT_BRIDGE_PORT || 3000);
  app.listen(port, () => {
    console.log(`🔌 GPT連携ブリッジを起動しました: http://localhost:${port}`);
  });
}

function buildMenuEmbed() {
  return new EmbedBuilder()
    .setTitle('📋 シリウスA メニュー')
    .setDescription(`${MENU_LINES.join('\n')}\n\n数字を送信するか、下のボタンをタップしてください。`)
    .setColor(0x4f46e5);
}

function buildMenuButtons() {
  const rows = [];
  for (let i = 1; i <= 13; i += 3) {
    const row = new ActionRowBuilder();
    for (let j = i; j < i + 3 && j <= 13; j += 1) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`menu_${j}`)
          .setLabel(`${j}`)
          .setStyle(ButtonStyle.Secondary)
      );
    }
    rows.push(row);
  }
  return rows;
}

async function sendLongMessage(channel, text) {
  const max = 1800;
  if (text.length <= max) return channel.send(text);
  const chunks = [];
  for (let i = 0; i < text.length; i += max) chunks.push(text.slice(i, i + max));
  for (const chunk of chunks) {
    await channel.send(chunk);
  }
}

function aiUnavailable() {
  return 'OPENAI_API_KEYが未設定です。設定後に有効化できます。';
}

async function callOpenAI(systemPrompt, userPrompt) {
  if (!openai) return aiUnavailable();
  const response = await openai.responses.create({
    model: 'gpt-4.1-mini',
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  return response.output_text || '生成結果が空でした。';
}

async function handlePdfSummary(message) {
  const pdfAttachment = message.attachments.find((a) => a.contentType === 'application/pdf' || a.name?.toLowerCase().endsWith('.pdf'));
  if (!pdfAttachment) return false;

  if (!openai) {
    await message.reply(aiUnavailable());
    return true;
  }

  try {
    const res = await fetch(pdfAttachment.url);
    const arrayBuffer = await res.arrayBuffer();
    const data = await pdfParse(Buffer.from(arrayBuffer));

    const summary = await callOpenAI(
      'あなたは有能な要約アシスタントです。日本語で簡潔かつ実務的に答えてください。',
      `以下のPDF本文を要約してください。\n\n出力形式:\n- 要約\n- 重要ポイント\n- 次にやるべきこと\n- 不明点や注意点\n\nPDF本文:\n${data.text.slice(0, 12000)}`
    );
    await sendLongMessage(message.channel, `📄 **PDF自動要約**\n\n${summary}`);
  } catch (error) {
    await message.reply(`PDFの読み取りまたは要約に失敗しました。ファイル形式をご確認ください。\n詳細: ${error.message}`);
  }
  return true;
}

function parseReminder(input) {
  const match = input.trim().match(/^(\d+)\s*([mhd])\s+(.+)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const task = match[3].trim();
  const multiplier = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return { delayMs: value * multiplier, task };
}

function getPromptByMenu(selection) {
  const prompts = {
    '1': 'note記事のテーマを入力してください。',
    '2': 'X投稿文のテーマを入力してください。',
    '3': 'Instagram投稿のテーマを入力してください。',
    '4': 'Threads投稿のテーマを入力してください。',
    '5': '生成したい画像テーマを入力してください。',
    '6': '検索したいテーマを入力してください。',
    '13': 'リマインダー内容を入力してください（例: 30m ミーティングの準備）。',
  };
  return prompts[selection];
}

async function handleMenuAction(selection, input) {
  switch (selection) {
    case '1':
      return callOpenAI('あなたはnote記事作成のプロです。わかりやすく実用的で読みやすい文章にしてください。', `テーマ: ${input}\n\n以下の形式で日本語出力:\n- タイトル\n- 導入文\n- 見出し構成\n- 本文（2000〜3000字）\n- まとめ\n- 挿絵用画像プロンプト\n- 画像生成結果または画像プロンプト`);
    case '2':
      return callOpenAI('あなたはSNSマーケターです。簡潔で魅力的な文章を作成してください。', `テーマ: ${input}\n\n以下の形式で日本語出力:\n- X投稿文 1〜3案（各140字以内を意識）\n- ハッシュタグ\n- 画像生成プロンプト\n- 画像生成結果または画像プロンプト`);
    case '3':
      return callOpenAI('あなたはInstagram運用の専門家です。', `テーマ: ${input}\n\n以下の形式で日本語出力:\n- 投稿キャプション\n- 1枚目画像の見出し案\n- カルーセル構成案\n- ハッシュタグ\n- 画像生成プロンプト\n- 画像生成結果または画像プロンプト`);
    case '4':
      return callOpenAI('あなたはThreads運用の専門家です。自然な語り口で、対話を生む投稿を作成してください。', `テーマ: ${input}\n\n以下の形式で日本語出力:\n- Threads向け投稿文\n- コメントを誘発する締め\n- 画像生成プロンプト\n- 画像生成結果または画像プロンプト`);
    case '5':
      return callOpenAI('あなたは画像生成プロンプト設計の専門家です。', `テーマ: ${input}\n\n以下の形式で日本語出力:\n- 画像生成プロンプト\n- 画像生成結果（画像生成API未設定ならプロンプトのみ）`);
    case '6':
      if (!process.env.WEB_SEARCH_API_KEY) return 'Web検索APIが未設定です。API設定後に有効化できます。';
      return callOpenAI('あなたはWeb調査アシスタントです。', `検索テーマ: ${input}\n\n一般的な知識に基づいて、以下形式でまとめてください:\n- 要点まとめ\n- 重要ポイント\n- 参考URL\n- 注意点\n\n※検索APIキーはあるが、実API接続は将来拡張。`);
    default:
      return '不明なメニューです。';
  }
}

async function handleSelection(source, userId, selection) {
  if (['7', '8', '9', '10', '11', '12'].includes(selection)) {
    await source.reply(STUB_MESSAGE);
    return;
  }
  userState.set(userId, { selection });
  await source.reply(getPromptByMenu(selection));
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'ai') {
    userState.delete(interaction.user.id);
    await interaction.reply({ embeds: [buildMenuEmbed()], components: buildMenuButtons() });
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('menu_')) {
    const selection = interaction.customId.replace('menu_', '');
    await handleSelection(interaction, interaction.user.id, selection);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (await handlePdfSummary(message)) return;

  const content = message.content.trim();
  if (content === '秘書' || content === 'シリウス召喚' || content === '!ai') {
    userState.delete(message.author.id);
    await message.channel.send({ embeds: [buildMenuEmbed()], components: buildMenuButtons() });
    return;
  }

  if (/^(?:[1-9]|1[0-3])$/.test(content)) {
    await handleSelection(message, message.author.id, content);
    return;
  }

  const state = userState.get(message.author.id);
  if (!state) return;

  try {
    if (state.selection === '13') {
      const reminder = parseReminder(content);
      if (!reminder) {
        await message.reply('形式が正しくありません。例: `30m ミーティングの準備`');
        return;
      }
      // NOTE: 現在はメモリ内setTimeoutのため、Bot再起動で失われます。将来的にDB保存へ移行予定。
      setTimeout(async () => {
        try {
          await message.author.send(`⏰ リマインダー\n${reminder.task}の時間です。`);
        } catch {
          await message.channel.send(`${message.author} さんへのDM送信に失敗しました。`);
        }
      }, reminder.delayMs);
      await message.reply(`了解しました。${reminder.task} を ${Math.round(reminder.delayMs / 60000)}分後に通知します。`);
      userState.delete(message.author.id);
      return;
    }

    const result = await handleMenuAction(state.selection, content);
    await sendLongMessage(message.channel, result);
  } catch (error) {
    await message.reply(`処理中にエラーが発生しました: ${error.message}`);
  } finally {
    userState.delete(message.author.id);
  }
});

client.once('ready', async () => {
  try {
    const token = process.env.DISCORD_BOT_TOKEN;
    const appId = process.env.DISCORD_APP_ID || client.user.id;
    const rest = new REST({ version: '10' }).setToken(token);
    const commands = [new SlashCommandBuilder().setName('ai').setDescription('シリウスAメニューを表示').toJSON()];
    await rest.put(Routes.applicationCommands(appId), { body: commands });
  } catch (error) {
    console.error(`スラッシュコマンド登録に失敗しました: ${error.message}`);
  }
  console.log('🤖 シリウスAが起動しました。');
  startGptBridgeServer();
});

if (!process.env.DISCORD_BOT_TOKEN) {
  console.error('DISCORD_BOT_TOKENが未設定です。');
  process.exit(1);
}

client.login(process.env.DISCORD_BOT_TOKEN);
