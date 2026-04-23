# 料韓男 頭目會議 · 會議記錄整理系統

上傳逐字稿 .txt 檔案，自動產出標準格式會議記錄。

## 部署到 Vercel

### 步驟一：推送到 GitHub

1. 在 GitHub 建立新的 repository（例如 `meeting-minutes`）
2. 在本機執行：
```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/你的帳號/meeting-minutes.git
git push -u origin main
```

### 步驟二：Vercel 部署

1. 前往 [vercel.com](https://vercel.com) 登入
2. 點「Add New Project」→ 選擇你的 GitHub repo
3. Framework Preset 選 **Next.js**（Vercel 會自動偵測）
4. 點「Deploy」

### 步驟三：設定 API Key（重要！）

部署完成後：
1. 進入 Vercel Project → **Settings** → **Environment Variables**
2. 新增：
   - Name: `ANTHROPIC_API_KEY`
   - Value: 你的 Anthropic API Key（從 [console.anthropic.com](https://console.anthropic.com) 取得）
3. 儲存後，點「Redeploy」讓設定生效

## 本機開發

```bash
cp .env.example .env.local
# 填入你的 API Key

npm install
npm run dev
```

打開 http://localhost:3000

## 功能說明

- 上傳 `.txt` 逐字稿（點擊或拖曳）
- AI 自動分析並整理成頭目會議格式
- 支援列印 / 存成 PDF
