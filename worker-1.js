// রুজি – এআই লেখার সহায়ক (Cloudflare Worker)
// দ্রষ্টব্য: এই ফাইলটি এখনো আসল Cloudflare-এ চালিয়ে পরীক্ষা করা হয়নি।
//
// সেটআপ (Cloudflare ড্যাশবোর্ডে):
// 1) Workers & Pages → Create → Worker → এই কোড পেস্ট করে Deploy
// 2) Settings → Bindings: (ক) Workers AI, নাম  AI   (খ) KV namespace, নাম  RL
// 3) Settings → Variables:
//      FIREBASE_API_KEY = আপনার Firebase apiKey (index.html-এ আছে)
//      ALLOWED_ORIGIN   = https://আপনার-ইউজারনেম.github.io   (শেষে / ছাড়া; একাধিক হলে কমা দিয়ে)
// 4) Worker-এর ঠিকানাটি index.html-এ  var AI_URL=""  এর ভেতরে বসান

const USER_DAILY = 10;   // একজন ব্যবহারকারী দিনে সর্বোচ্চ কতবার
const TOTAL_DAILY = 150; // সবার মিলিয়ে দিনে সর্বোচ্চ (বিনামূল্যে সীমার ভেতরে থাকতে)
const MODEL = "@cf/meta/llama-3.1-8b-instruct";

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    // ALLOWED_ORIGIN-এ কমা দিয়ে একাধিক ঠিকানা দেওয়া যাবে (যেমন GitHub Pages + নিজের ডোমেইন)
    const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean);
    const ok = !!origin && allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": ok ? origin : "null",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    };
    const out = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST" || !ok) return out({ error: "forbidden" }, 403);
    if (parseInt(req.headers.get("Content-Length") || "0", 10) > 2000) return out({ error: "size" }, 413);
    let raw = "";
    try { raw = await req.text(); } catch (e) { return out({ error: "body" }, 400); }
    if (raw.length > 2000) return out({ error: "size" }, 413);

    // ১) Firebase লগইন যাচাই (অফিসিয়াল Identity Toolkit)
    const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!tok) return out({ error: "auth" }, 401);
    let uid = "";
    try {
      const r = await fetch(
        "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(env.FIREBASE_API_KEY),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: tok }) }
      );
      if (!r.ok) return out({ error: "auth" }, 401);
      const j = await r.json();
      const u = j.users && j.users[0];
      uid = u && !u.disabled ? u.localId : "";
    } catch (e) { return out({ error: "auth" }, 401); }
    if (!uid) return out({ error: "auth" }, 401);

    // ২) বিষয় যাচাই
    let topic = "", tone = "all", lang = "bn";
    try { const b = JSON.parse(raw); topic = String(b.topic || ""); tone = String(b.tone || "all"); lang = b.lang === "en" ? "en" : "bn"; } catch (e) {}
    const TONES = { all: "যেকোনো ধরনের", think: "ভাবনামূলক", ask: "প্রশ্ন করে মন্তব্য চাওয়ার ধরনের", wish: "শুভেচ্ছামূলক", thanks: "কৃতজ্ঞতা জানানোর", short: "খুব ছোট (১ বাক্য)" };
    const TONES_EN = { all: "any", think: "thoughtful", ask: "asking a question to get comments", wish: "good wishes", thanks: "gratitude", short: "very short (one sentence)" };
    const toneTxt = TONES[tone] || TONES.all;
    const toneEn = TONES_EN[tone] || TONES_EN.all;
    topic = topic.replace(/[\r\n]+/g, " ").trim().slice(0, 80);
    if (!topic) return out({ error: "topic" }, 400);

    // ৩) দৈনিক সীমা (ব্যবহারকারী ও মোট)
    const day = new Date().toISOString().slice(0, 10);
    const ku = "u:" + uid + ":" + day, kt = "t:" + day;
    try {
      const nu = parseInt((await env.RL.get(ku)) || "0", 10);
      const nt = parseInt((await env.RL.get(kt)) || "0", 10);
      if (nu >= USER_DAILY || nt >= TOTAL_DAILY) return out({ error: "limit" }, 429);
      await env.RL.put(ku, String(nu + 1), { expirationTtl: 172800 });
      await env.RL.put(kt, String(nt + 1), { expirationTtl: 172800 });
    } catch (e) { return out({ error: "kv" }, 503); } // গণনা করা না গেলে নিরাপদে থামাই

    // এআই ব্যর্থ হলে ব্যবহারকারীর সুযোগ ফেরত দিই (সর্বোচ্চ চেষ্টা)
    const refund = async () => {
      try {
        const a = parseInt((await env.RL.get(ku)) || "1", 10), b = parseInt((await env.RL.get(kt)) || "1", 10);
        await env.RL.put(ku, String(Math.max(0, a - 1)), { expirationTtl: 172800 });
        await env.RL.put(kt, String(Math.max(0, b - 1)), { expirationTtl: 172800 });
      } catch (e) {}
    };

    // ৪) এআই
    const systemBn =
      "তুমি একটি বাংলা সোশ্যাল অ্যাপের লেখার সহায়ক। ব্যবহারকারীর দেওয়া বিষয়ে ঠিক ৩টি আলাদা সংক্ষিপ্ত পোস্টের খসড়া লিখবে, " +
      "ধরন: " + toneTxt + "। প্রতিটি সহজ বাংলায়, ১-৩ বাক্যের, ভদ্র ভাষায়। খসড়াগুলোর মাঝে একটি লাইনে শুধু ### লিখবে। অন্য কোনো ভূমিকা বা ব্যাখ্যা দেবে না। " +
      "ঘৃণা, গালি, যৌন, সহিংস, ভুয়া খবর, চিকিৎসা বা আর্থিক পরামর্শ, কোনো আসল ব্যক্তির নামে মানহানি বা ছদ্মবেশ বিষয়ে লিখবে না; " +
      "এমন বিষয় এলে নিরীহ একটি সাধারণ শুভেচ্ছা লিখবে।";
    const systemEn =
      "You are a writing helper for a social app. Write exactly 3 different short post drafts about the user's topic, " +
      "tone: " + toneEn + ". Each draft is in simple, polite English, 1-3 sentences. Put a line containing only ### between drafts. No preface or explanation. " +
      "Never write about hate, abuse, sexual or violent content, fake news, medical or financial advice, or defaming or impersonating real people; " +
      "for such topics write a harmless general greeting instead.";
    const system = lang === "en" ? systemEn : systemBn;
    const userMsg = (lang === "en" ? "Topic: " : "বিষয়: ") + topic;
    try {
      const res = await env.AI.run(MODEL, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        max_tokens: 800, // বাংলায় টোকেন বেশি লাগে, তাই বেশি রাখা হলো
      });
      const txt = String((res && (res.response || res.result)) || "");
      const drafts = parseDrafts(txt);
      if (!drafts.length) { await refund(); return out({ error: "empty" }, 502); }
      return out({ drafts });
    } catch (e) {
      await refund();
      return out({ error: "ai" }, 502);
    }
  },
};

// মডেলের উত্তর থেকে খসড়া বের করা: ### → নম্বর দেওয়া লাইন → ফাঁকা লাইন → প্রতি লাইন, এই ক্রমে চেষ্টা; ভূমিকা-লাইন বাদ
function parseDrafts(txt) {
  const clean = (list) => list
    .map((x) => x.trim()
      .replace(/^\s*(?:[\d০-৯]+[.)।:]|[-*•])\s*/, "") // শুরুর নম্বর/বুলেট
      .replace(/\*\*/g, "")
      .replace(/^["“”']+|["“”']+$/g, "")
      .trim())
    .filter((x) => x.length > 1)
    .filter((x) => !(x.length < 90 && /[:：]$/.test(x))) // "এখানে ৩টি খসড়া:" জাতীয় ভূমিকা
    .filter((x) => !/^(here (are|is)|sure|এখানে|নিচে)/i.test(x))
    .map((x) => x.slice(0, 600))
    .filter((x) => !/https?:\/\/|www\.|[\d০-৯]{6,}/i.test(x)); // লিংক বা ফোন নম্বর (বাংলা সংখ্যাসহ) বাদ
  const tries = [
    (t) => t.split(/^\s*#{3,}\s*$/m),
    (t) => t.split(/(?:^|\n)\s*[\d০-৯]+[.)।]\s+/),
    (t) => t.split(/\n\s*\n/),
    (t) => t.split(/\n/),
  ];
  let best = [];
  for (const f of tries) {
    const c = clean(f(txt));
    if (c.length >= 2) return c.slice(0, 3);
    if (c.length > best.length) best = c;
  }
  return best.slice(0, 3);
}
