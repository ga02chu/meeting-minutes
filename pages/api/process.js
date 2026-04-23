import Anthropic from "@anthropic-ai/sdk";

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

const STAFF = `
【員工名單】以下是唯一合法的員工名單，提到時只稱名字（去掉姓氏）：
廖韋豪→韋豪 黃郁潔→郁潔 邱筱庭→筱庭 陳顯耀→顯耀 賴姵妤→姵妤
出曜綸→曜綸 鄭吏伸→吏伸 陳耀恩→耀恩 黃唯恩→唯恩 陳皇旭→皇旭
林嘉德→嘉德 朱祐呈→祐呈 簡嘉良→嘉良 黃廷曜→廷曜 李彥錞→彥錞
梁翰剛→Hank 葉宸維→宸維 陳宜珊→宜珊 賴羽宣→羽宣 徐嘉玟→嘉玟
高嘉妤→嘉妤 陳碩安→碩安 張倚瑄→倚瑄 林怡君→怡君 黃柏凱→柏凱
陳孟強→孟強 王閎鈞→閎鈞 梁瑄倢→瑄倢 張譯尹→譯尹 方啟岷→啟岷
陳祈福→祈福 王郁萱→郁萱 陳立愷→立愷 賴文勝→文勝 吳明臻→明臻
蔡亞熾→亞熾 洪羽萱→羽萱 許瀚文→瀚文 鄭梓彥→梓彥 黃冠達→冠達
李秉承→秉承 方瑞翔→瑞翔 蘇湘芸→湘芸 蔡若文→若文 潘采盈→采盈
葛心瑜→心瑜 林慧麗→慧麗 周秉祥→秉祥 黃智雄→智雄 黃晨屹→晨屹
盧宣蓉→宣蓉 林芷瑢→芷瑢 王煒綸→煒綸 温睿辰→睿辰 周聖棠→聖棠
余杰廷→杰廷 陳昱勳→昱勳 駱思穎→思穎
佑成/祐成→祐呈(朱祐呈) 嘉瑜→嘉妤(高嘉妤) 若雯→若文(蔡若文)
楊心怡→小拉 李亭姗→Apple

【常見誤辨】以下是錄音常見錯誤，請自動修正：佑成/祐成/右成→祐呈、嘉瑜→嘉妤、若雯→若文、玉姐/玉潔→郁潔、鈺姐→郁潔

【重要】如果逐字稿中出現上方名單以外的人名（包含諧音、模糊發音），請勿自行猜測或創造名字。
把那些無法確認的原始名字列在 unknownPersons 欄位，會議記錄內文中以 【？原始名字？】 標示。`;

const STORES = `
【門市名稱統一】
2號店/明曜/明曜店 → 明曜店
品概/品概店/仁愛店/仁愛 → 品概店
台中/台中店/3號店/三號店 → 台中店
英洙家 → 英洙家
桃園/桃園店/加盟店 → 桃園店`;

const SYSTEM_PROMPT = `你是料韓男餐廳連鎖品牌的專業會議記錄整理助手。

【固定規則】
- 佳盈/闆娘統一稱「闆娘」
- 系統：ichef
- 繁體中文
${STORES}
${STAFF}

【輸出格式】純 JSON，不加 markdown：

{
  "date": "從逐字稿推斷日期，格式 YYYY-MM-DD。TODAY_PLACEHOLDER。無法確定則用今天日期",
  "subtitle": "10-20字重點摘要",
  "unknownPersons": ["無法對應名單的原始名字"],
  "actions": [
    {"person": "名字（必須在名單內，不確定則填？）", "task": "具體事項", "deadline": "期限或空字串"}
  ],
  "html": "完整會議記錄HTML"
}

【HTML 結構】
<div class="minutes-container">
  <div class="minutes-header">
    <h1>會議記錄｜[日期] 頭目會議</h1>
    <div class="meta-row"><span class="meta-label">出席人員</span><span class="meta-value">[人員]</span></div>
    <div class="meta-row"><span class="meta-label">會議地點</span><span class="meta-value">[地點]</span></div>
    <div class="meta-row"><span class="meta-label">會議時間</span><span class="meta-value">[時間]</span></div>
  </div>
  <div class="section"><h2>[主題]</h2><ul><li>...</li></ul></div>
  <div class="section resolved">
    <h2>✓ 已決議事項</h2>
    <ul class="resolved-list"><li>...</li></ul>
  </div>
</div>

行動清單不放在 html 裡。`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { transcript } = req.body;
  if (!transcript) return res.status(400).json({ error: "Missing transcript" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "API key not configured" });

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      // Inject today's date dynamically
      const today = new Date()
      const todayStr = today.toISOString().slice(0, 10)
      const year = today.getFullYear()
      const dynamicSystem = SYSTEM_PROMPT.replace('TODAY_PLACEHOLDER', \`今天是 \${todayStr}，今年是 \${year} 年，若逐字稿未明確提及年份，預設為 \${year} 年\`)
      model: "claude-opus-4-5",
      max_tokens: 4096,
      system: dynamicSystem,
      messages: [{ role: "user", content: `以下是會議錄音逐字稿，請整理並輸出 JSON：\n\n${transcript}` }],
    });

    let text = message.content[0].text.trim()
      .replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const data = JSON.parse(text);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: error.message || "Failed to process" });
  }
}
