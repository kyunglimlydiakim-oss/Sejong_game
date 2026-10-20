// 표준국어대사전 오픈 API 중계(Vercel 서버리스 함수 공용 코드).
// 인증키는 Vercel 프로젝트의 환경 변수 STDICT_API_KEY에 둔다. 브라우저에는 내려가지 않는다.
const API_URL = "https://stdict.korean.go.kr/api/search.do";
const HANGUL = /^[가-힣]{2,4}$/;

function apiKey() {
  return (process.env.STDICT_API_KEY || "").trim();
}

async function lookup(word) {
  const params = new URLSearchParams({
    key: apiKey(),
    q: word,
    req_type: "json",
    advanced: "y",
    method: "exact",
    type1: "word",
    letter_s: String(word.length),
    letter_e: String(word.length),
    num: "10",
  });
  const res = await fetch(`${API_URL}?${params}`, {
    headers: { "User-Agent": "sejong-game/1.0" },
    signal: AbortSignal.timeout(6000),
  });
  const body = (await res.text()).trim();
  // 결과가 없으면 빈 응답이 오기도 한다.
  const data = body ? JSON.parse(body) : {};
  if (data.error) throw new Error(`API 오류 ${data.error.error_code}: ${data.error.message}`);

  let items = (data.channel && data.channel.item) || [];
  if (!Array.isArray(items)) items = [items];
  const senses = [];
  for (const it of items) {
    // 표제어에는 '나무-꾼', '물^고기' 같은 구분 기호가 붙을 수 있다.
    if (String(it.word || "").replace(/[-^\s]/g, "") !== word) continue;
    const sense = Array.isArray(it.sense) ? it.sense[0] || {} : it.sense || {};
    senses.push({ sup_no: it.sup_no, pos: it.pos || "", definition: sense.definition || "", link: sense.link || "" });
  }
  return { found: senses.length > 0, word, senses };
}

module.exports = { HANGUL, apiKey, lookup };
