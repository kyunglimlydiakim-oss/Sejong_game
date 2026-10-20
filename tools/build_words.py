"""words.js를 다시 만든다.

국립국어원 사전 전체 내려받기 XML이 필요하다(표준국어대사전·한국어기초사전 각 사이트,
또는 https://github.com/spellcheck-ko/korean-dict-nikl 의 stdict/, krdict/ 폴더).

    python3 tools/build_words.py 경로/stdict 경로/krdict words.js
"""
import collections
import glob
import json
import re
import sys

CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
HANGUL = re.compile(r"^[가-힣]{2,4}$")
MIN_POOL = {2: 10, 3: 10, 4: 6}  # 그(?)가 한 판(5차례)을 버틸 만큼의 낱말 수


def pattern(w):
    return "".join(CHO[(ord(s) - 0xAC00) // 588] for s in w)


def cdata(tag, block):
    m = re.search(r"<%s>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</%s>" % (tag, tag), block, re.S)
    return m.group(1) if m else ""


def read_stdict(folder):
    """표준국어대사전: 두~네 글자 '단어' 표제어와 품사."""
    words = {}
    for f in sorted(glob.glob(folder + "/*.xml")):
        text = open(f, encoding="utf-8", errors="replace").read()
        for m in re.finditer(r"<item>(.*?)</item>", text, re.S):
            b = m.group(1)
            w = re.sub(r"[-^\s]|\d+$", "", cdata("word", b))  # 동음이의어 번호(가방01)도 뗀다
            if HANGUL.match(w) and cdata("word_unit", b) == "단어":
                words.setdefault(w, set()).update(re.findall(r"<pos>(.*?)</pos>", b))
    return words


def read_krdict(folder):
    """한국어기초사전: (표제어, 품사, 등급)."""
    rows = []
    for f in sorted(glob.glob(folder + "/*.xml")):
        text = open(f, encoding="utf-8", errors="replace").read()
        for m in re.finditer(r"<LexicalEntry [^>]*>(.*?)</LexicalEntry>", text, re.S):
            head = m.group(1).split("<Sense", 1)[0]
            feat = lambda k: (re.search(r'<feat att="%s" val="([^"]*)"' % k, head) or [None, ""])[1]
            lemma = re.search(r'<Lemma>\s*<feat att="writtenForm" val="([^"]*)"', head)
            if lemma and feat("lexicalUnit") == "단어":
                rows.append((lemma.group(1), feat("partOfSpeech"), feat("vocabularyLevel")))
    return rows


def main(std_dir, kr_dir, out):
    std = read_stdict(std_dir)
    kr = [r for r in read_krdict(kr_dir) if r[0] in std]
    easy2 = {w for w, pos, lv in kr if len(w) == 2 and pos == "명사" and lv in ("초급", "중급")}
    pools = {
        2: {w for w, pos, _ in kr if len(w) == 2 and pos == "명사"},
        3: {w for w, pos, _ in kr if len(w) == 3 and pos == "명사"},
        # 네 글자: 기초사전 명사·부사 + 쉬운 두 글자 명사 둘을 이은 표준국어대사전 명사
        4: {w for w, pos, _ in kr if len(w) == 4 and pos in ("명사", "부사")}
        | {w for w, poss in std.items() if len(w) == 4 and "명사" in poss and w[:2] in easy2 and w[2:] in easy2},
    }
    rival = {}
    for n, ws in pools.items():
        groups = collections.defaultdict(list)
        for w in sorted(ws):
            groups[pattern(w)].append(w)
        rival.update({k: " ".join(v) for k, v in groups.items() if len(v) >= MIN_POOL[n]})
    dic = {str(n): "".join(sorted(w for w in std if len(w) == n)) for n in (2, 3, 4)}
    with open(out, "w", encoding="utf-8") as f:
        f.write("/* 낱말 자료. tools/build_words.py로 생성했다.\n"
                "   SEJONG_DICT: 「표준국어대사전」 두~네 글자 '단어' 표제어(글자 수별로 이어 붙임). 오프라인 판정용.\n"
                "   SEJONG_RIVAL: 그(?)가 내는 낱말(초성별). 「한국어기초사전」 명사 중심.\n"
                "   출처: 국립국어원. CC BY-SA 2.0 KR. 이 파일도 같은 조건을 따른다. */\n")
        f.write("window.SEJONG_DICT = " + json.dumps(dic, ensure_ascii=False) + ";\n")
        f.write("window.SEJONG_RIVAL = " + json.dumps(rival, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print({n: len(v) // int(n) for n, v in dic.items()}, collections.Counter(len(k) for k in rival))


if __name__ == "__main__":
    main(*sys.argv[1:4])
