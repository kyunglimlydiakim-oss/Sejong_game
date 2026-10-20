const { HANGUL, apiKey, lookup } = require("./_stdict");

module.exports = async (req, res) => {
  const word = String(req.query.q || "").trim();
  if (!HANGUL.test(word)) return res.status(400).json({ error: "한글 두~네 글자만 검색할 수 있습니다." });
  if (!apiKey()) return res.status(503).json({ error: "STDICT_API_KEY가 설정되지 않았습니다." });
  try {
    const result = await lookup(word);
    // 같은 낱말은 하루 동안 CDN에 담아 두어 일일 호출 한도를 아낀다.
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json(result);
  } catch (e) {
    return res.status(502).json({ error: `표준국어대사전 연결 실패: ${e.message}` });
  }
};
