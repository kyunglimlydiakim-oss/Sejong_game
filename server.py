"""'그(?)와 함께 세종대왕' 게임 서버.

정적 파일(index.html, words.js)을 내주고, 브라우저 대신 국립국어원
표준국어대사전 오픈 API를 불러 준다. 표준국어대사전 API는 인증키가 필요하고
브라우저에서 직접 부르면 CORS에 막히므로 이 서버가 중계한다.

    python3 server.py   # http://localhost:8000

인증키는 이 파일 옆 api_key.txt에 한 줄로 적거나, 환경 변수 STDICT_API_KEY로 넘긴다.

인증키 발급: https://stdict.korean.go.kr/openapi/openApiInfo.do
키 없이 실행하면 게임은 내장 단어 목록(오프라인 모드)으로 돌아간다.
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

API_URL = "https://stdict.korean.go.kr/api/search.do"
PORT = int(os.environ.get("PORT", "8000"))
ROOT = os.path.dirname(os.path.abspath(__file__))
KEY_FILE = os.path.join(ROOT, "api_key.txt")  # 저장소에 올라가지 않도록 .gitignore에 넣었다


def load_key():
    key = os.environ.get("STDICT_API_KEY", "").strip()
    if not key and os.path.exists(KEY_FILE):
        with open(KEY_FILE, encoding="utf-8-sig") as f:
            key = f.read().strip()
    return key


API_KEY = load_key()
HANGUL = re.compile(r"^[가-힣]{2,4}$")
_cache = {}


def lookup(word):
    """표준국어대사전에서 같은 음절 수의 어휘 표제어를 정확히 일치 검색한다."""
    if word in _cache:
        return _cache[word]
    params = {
        "key": API_KEY,
        "q": word,
        "req_type": "json",
        "advanced": "y",
        "method": "exact",
        "type1": "word",
        "letter_s": str(len(word)),
        "letter_e": str(len(word)),
        "num": "10",
    }
    url = API_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "sejong-game/1.0"})
    with urllib.request.urlopen(req, timeout=6) as res:
        body = res.read().decode("utf-8", "replace").strip()

    # 결과가 없으면 빈 응답이 오기도 한다.
    data = json.loads(body) if body else {}
    if "error" in data:
        err = data["error"]
        raise RuntimeError(f"API 오류 {err.get('error_code')}: {err.get('message')}")

    items = (data.get("channel") or {}).get("item") or []
    if isinstance(items, dict):
        items = [items]
    senses = []
    for it in items:
        # 표제어에는 '나무-꾼', '물^고기' 같은 구분 기호가 붙을 수 있다.
        head = re.sub(r"[-^\s]", "", str(it.get("word", "")))
        if head != word:
            continue
        sense = it.get("sense") or {}
        if isinstance(sense, list):
            sense = sense[0] if sense else {}
        senses.append({
            "sup_no": it.get("sup_no"),
            "pos": it.get("pos", ""),
            "definition": sense.get("definition", ""),
            "link": sense.get("link", ""),
        })
    result = {"found": bool(senses), "word": word, "senses": senses}
    _cache[word] = result
    return result


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/status":
            return self._json(200, {"stdict": bool(API_KEY)})
        if parsed.path == "/api/lookup":
            word = urllib.parse.parse_qs(parsed.query).get("q", [""])[0].strip()
            if not HANGUL.match(word):
                return self._json(400, {"error": "한글 두~네 글자만 검색할 수 있습니다."})
            if not API_KEY:
                return self._json(503, {"error": "STDICT_API_KEY가 설정되지 않았습니다."})
            try:
                return self._json(200, lookup(word))
            except (urllib.error.URLError, TimeoutError, ValueError, RuntimeError) as e:
                return self._json(502, {"error": f"표준국어대사전 연결 실패: {e}"})
        return super().do_GET()


if __name__ == "__main__":
    mode = "표준국어대사전 연동" if API_KEY else "오프라인(내장 단어 목록)"
    print(f"그(?)와 함께 세종대왕 — http://localhost:{PORT}  [{mode}]")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
