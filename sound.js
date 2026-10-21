/* SoundManager — 소리 파일 없이 Web Audio API로 효과음과 배경음악을 실시간 합성한다.
 *
 *   SoundManager.play("coin")        // coin | click | levelup | gameover | hit
 *   SoundManager.play("hit", { volume: 0.4 })
 *   SoundManager.bgm.start()         // 아리랑 후렴을 8비트 풍으로 되풀이
 *   SoundManager.bgm.stop()
 *   SoundManager.toggleMute()
 *
 * 브라우저 자동 재생 정책: AudioContext는 사용자가 처음 누르거나 키를 칠 때 만들고 깨운다.
 * 그 전에 play()를 부르면 조용히 무시하고, bgm.start()는 첫 상호작용 뒤로 미룬다.
 * 아이폰 무음 스위치가 켜져 있어도 들리도록 오디오 세션을 '재생'으로 바꾼다(kickMediaSession).
 * 타입 정의는 sound.d.ts에 있다. renderOffline(name)으로 소리를 파일 없이 미리 렌더링할 수 있다.
 */
(function () {
  "use strict";

  const AC = window.AudioContext || window.webkitAudioContext;
  const MUTE_KEY = "sejong-muted";
  const SFX_GAIN = 0.5;
  const BGM_GAIN = 0.16;

  let ctx = null;
  let master = null; // 전체 음량(음소거)
  let sfxBus = null;
  let bgmBus = null;
  let noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (_) {}

  // ---- 공통 부품 ----
  function build(c) {
    const m = c.createGain();
    m.gain.value = muted && c === ctx ? 0 : 1;
    // 레트로 소리는 고역이 날카롭다. 살짝 깎아 귀를 덜 찌르게 한다.
    const tone = c.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 9000;
    tone.connect(m).connect(c.destination);
    const sfx = c.createGain();
    sfx.gain.value = SFX_GAIN;
    sfx.connect(tone);
    const bgm = c.createGain();
    bgm.gain.value = BGM_GAIN;
    bgm.connect(tone);
    return { master: m, sfx, bgm };
  }

  function makeNoise(c) {
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** 오실레이터 하나에 ADSR형 엔벨로프를 건다. */
  function tone(c, out, { type = "square", freq, endFreq, t, dur, vol = 1, attack = 0.005, release = 0.05, glide = "exp" }) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) {
      if (glide === "exp") o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
      else o.frequency.linearRampToValueAtTime(endFreq, t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
    return o;
  }

  function noise(c, out, buf, { t, dur, vol = 1, filter = "lowpass", from = 4000, to = 300, q = 0.8 }) {
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  const N = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  // ---- 효과음 ----
  const SFX = {
    // 띠링~: 사각파 B5 → E6 두 음. 둘째 음을 길게 끌어 반짝이는 꼬리를 남긴다.
    coin(c, out, t, v) {
      tone(c, out, { type: "square", freq: N(83), t, dur: 0.07, vol: 0.35 * v, release: 0.01 });
      tone(c, out, { type: "square", freq: N(88), t: t + 0.07, dur: 0.38, vol: 0.32 * v, release: 0.3 });
      return 0.45;
    },
    // 톡-: 삼각파가 1.5kHz에서 0.04초 만에 떨어지는 짧은 딸깍
    click(c, out, t, v) {
      tone(c, out, { type: "triangle", freq: 1500, endFreq: 700, t, dur: 0.045, vol: 0.5 * v, attack: 0.002, release: 0.04 });
      tone(c, out, { type: "square", freq: 3000, t, dur: 0.012, vol: 0.08 * v, attack: 0.001, release: 0.01 });
      return 0.06;
    },
    // 도-미-솔-도: 사각파 아르페지오 + 한 옥타브 아래 삼각파. 마지막 도에 비브라토
    levelup(c, out, t, v) {
      const notes = [72, 76, 79, 84];
      const step = 0.085;
      notes.forEach((m, i) => {
        const last = i === notes.length - 1;
        const dur = last ? 0.5 : step;
        const o = tone(c, out, { type: "square", freq: N(m), t: t + i * step, dur, vol: 0.28 * v, release: last ? 0.35 : 0.02 });
        tone(c, out, { type: "triangle", freq: N(m - 12), t: t + i * step, dur, vol: 0.3 * v, release: last ? 0.35 : 0.02 });
        if (last) {
          const lfo = c.createOscillator();
          const depth = c.createGain();
          lfo.frequency.value = 7;
          depth.gain.value = 12;
          lfo.connect(depth).connect(o.frequency);
          lfo.start(t + i * step + 0.08);
          lfo.stop(t + i * step + dur);
        }
      });
      return notes.length * step + 0.5;
    },
    // 스르륵 툭: 톱니파가 440Hz에서 55Hz로 미끄러지고 필터가 닫힌다. 끝에 낮은 쿵
    gameover(c, out, t, v) {
      const o = c.createOscillator();
      const f = c.createBiquadFilter();
      const g = c.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(440, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 1.0);
      f.type = "lowpass";
      f.frequency.setValueAtTime(2400, t);
      f.frequency.exponentialRampToValueAtTime(180, t + 1.0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4 * v, t + 0.02);
      g.gain.setValueAtTime(0.4 * v, t + 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
      o.connect(f).connect(g).connect(out);
      o.start(t);
      o.stop(t + 1.1);
      // 계단처럼 떨어지는 픽셀 느낌: 사각파가 반음씩 네 번 내려간다
      [64, 61, 58, 55].forEach((m, i) => tone(c, out, { type: "square", freq: N(m), t: t + i * 0.18, dur: 0.16, vol: 0.12 * v, release: 0.05 }));
      tone(c, out, { type: "triangle", freq: 90, endFreq: 40, t: t + 1.0, dur: 0.3, vol: 0.6 * v, attack: 0.003, release: 0.25 });
      return 1.35;
    },
    // 콰직: 화이트 노이즈를 저역 통과 필터로 빠르게 닫고, 사각파 쿵을 겹친다
    hit(c, out, t, v) {
      noise(c, out, noiseBuf || (noiseBuf = makeNoise(c)), { t, dur: 0.22, vol: 0.7 * v, from: 5000, to: 200 });
      tone(c, out, { type: "square", freq: 160, endFreq: 45, t, dur: 0.18, vol: 0.35 * v, attack: 0.002, release: 0.12 });
      return 0.25;
    },
  };

  // ---- 배경음악: 아리랑 후렴 ----
  // 세마치장단처럼 한 마디를 셋으로 나누고(3/4), 8분음표를 1로 센다.
  // 계이름 표기: 숫자는 도=1 … 라=6, 뒤의 '는 한 옥타브 위, ,는 아래. 콜론 뒤는 길이(8분음표 개수).
  // 가사: 아리랑 아리랑 아라리요 / 아리랑 고개로 넘어간다
  const ARIRANG = [
    "5:3 6:1 5:1 6:1", "1':3 2':1 1':1 2':1", "3':2 2':1 1':1 6:1 1':1", "2':2 6:1 5:3",
    "1':3 2':1 1':1 2':1", "3':2 2':1 1':1 6:1 5:1", "3:2 5:1 6:1 5:2", "5:6",
  ].join(" | ");
  const KEY_C = 60; // 도 = C4. 8비트 느낌을 살리려 한 옥타브 올려 쓴다(아래 +12)
  const SCALE = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
  function parseScore(score) {
    const out = [];
    for (const tok of score.split(/\s+/)) {
      if (!tok || tok === "|") continue;
      const m = tok.match(/^([1-7])([',]*):(\d+)$/);
      if (!m) continue;
      const oct = (m[2].match(/'/g) || []).length - (m[2].match(/,/g) || []).length;
      out.push({ midi: KEY_C + 12 + SCALE[m[1]] + 12 * oct, len: +m[3] });
    }
    return out;
  }
  const BGM = { tempo: 104, notes: parseScore(ARIRANG) }; // 4분음표 기준 BPM
  // 반주 베이스: 마디마다 첫 박에 한 음(도·라·솔)
  const BASS = [48, 48, 45, 43, 48, 45, 43, 43];

  /** 선율 한 음과 그 길이만큼의 반주를 예약한다. pos는 마디 안 위치(0~5), bar는 마디 번호. */
  function bgmNote(c, out, buf, n, t, cur) {
    const eighth = 60 / BGM.tempo / 2;
    const dur = n.len * eighth;
    tone(c, out, { type: "square", freq: N(n.midi), t, dur: dur * 0.92, vol: 0.22, attack: 0.008, release: Math.min(0.12, dur * 0.4) });
    for (let k = 0; k < n.len; k++) {
      const pos = (cur.pos + k) % 6;
      const bt = t + k * eighth;
      if (pos === 0) {
        // 첫 박: 삼각파 베이스 + 북처럼 둔한 '덩'
        tone(c, out, { type: "triangle", freq: N(BASS[cur.bar % BASS.length]), t: bt, dur: eighth * 3.6, vol: 0.5, release: 0.2 });
        noise(c, out, buf, { t: bt, dur: 0.12, vol: 0.18, from: 900, to: 120 });
      } else if (pos === 4) {
        // 셋째 박 뒤쪽: 채편처럼 가벼운 '덕'
        noise(c, out, buf, { t: bt, dur: 0.05, vol: 0.12, filter: "highpass", from: 6000, to: 3000 });
      }
      if (pos === 5) cur.bar += 1;
    }
    cur.pos = (cur.pos + n.len) % 6;
    return dur;
  }
  const LOOP_REST = 2; // 한 바퀴 돌고 쉬는 8분음표 수

  const bgm = {
    playing: false,
    wanted: false,
    _timer: null,
    _next: 0,
    _i: 0,
    _cur: { pos: 0, bar: 0 },
    start() {
      bgm.wanted = true;
      if (!ctx || bgm.playing) return;
      bgm.playing = true;
      bgm._i = 0;
      bgm._cur = { pos: 0, bar: 0 };
      bgm._next = ctx.currentTime + 0.1;
      // 앞을 0.2초씩 내다보고 미리 예약한다. setInterval의 흔들림이 박자에 새지 않는다.
      bgm._timer = setInterval(bgm._schedule, 50);
      bgm._schedule();
    },
    stop() {
      bgm.wanted = false;
      bgm.playing = false;
      clearInterval(bgm._timer);
    },
    _schedule() {
      while (bgm._next < ctx.currentTime + 0.2) {
        bgm._next += bgmNote(ctx, bgmBus, noiseBuf, BGM.notes[bgm._i], bgm._next, bgm._cur);
        bgm._i = (bgm._i + 1) % BGM.notes.length;
        if (bgm._i === 0) bgm._next += LOOP_REST * (60 / BGM.tempo / 2);
      }
    },
  };

  // ---- 오디오 깨우기 ----
  // 아이폰·아이패드는 무음(벨소리) 스위치를 켜 두면 Web Audio 소리를 죽인다.
  // Safari 17부터는 audioSession을 'playback'으로 바꾸면 미디어 소리로 취급된다.
  // 그보다 오래된 iOS는 사용자 동작 안에서 HTML <audio>를 한 번 재생하면 같은 효과가 난다.
  // 그 <audio>에 넣을 0.1초짜리 무음 WAV는 파일 없이 여기서 만든다.
  function silentWavUrl() {
    const n = 2205, v = new DataView(new ArrayBuffer(44 + n * 2));
    const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 22050, true); v.setUint32(28, 44100, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, "data"); v.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([v.buffer], { type: "audio/wav" }));
  }
  let sessionKicked = false;
  function kickMediaSession() {
    if (sessionKicked) return;
    sessionKicked = true;
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (_) {}
    try {
      const el = new Audio(silentWavUrl());
      el.setAttribute("playsinline", "");
      const p = el.play();
      if (p && p.catch) p.catch(() => { sessionKicked = false; });
    } catch (_) { sessionKicked = false; }
  }

  function unlock() {
    if (!AC) return;
    kickMediaSession();
    if (!ctx) {
      ctx = new AC();
      ({ master, sfx: sfxBus, bgm: bgmBus } = build(ctx));
      noiseBuf = makeNoise(ctx);
    }
    if (ctx.state !== "running") {
      ctx.resume();
      // 옛 iOS는 사용자 동작 안에서 버퍼를 한 번 틀어야 소리가 풀린다
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
    }
    if (bgm.wanted && !bgm.playing) bgm.start();
  }
  // iOS Safari는 pointerdown만으로는 소리를 풀어 주지 않는 경우가 있어 touchend·click도 함께 듣는다
  ["pointerdown", "touchend", "click", "keydown"].forEach((ev) => window.addEventListener(ev, unlock, { capture: true, passive: true }));
  // 탭을 떠나면 배경음악을 쉬고, 돌아오면 이어 간다
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });

  function play(name, opts = {}) {
    const fn = SFX[name];
    // 깨우는 중(suspended)이어도 예약해 둔다. resume이 끝나면 바로 이어서 들린다.
    if (!fn || !ctx || ctx.state === "closed") return;
    fn(ctx, sfxBus, ctx.currentTime + 0.005, opts.volume ?? 1);
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (_) {}
    if (ctx) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02);
    listeners.forEach((f) => f(muted));
  }
  const listeners = new Set();

  /** 테스트·미리 듣기용: 효과음이나 배경음악 한 바퀴("bgm")를 오프라인으로 렌더링한다. */
  function renderOffline(name, sampleRate = 44100) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const loop = BGM.notes.reduce((a, n) => a + n.len, 0) * (60 / BGM.tempo / 2);
    const c = new OAC(1, Math.ceil(sampleRate * (name === "bgm" ? loop + 1 : 2)), sampleRate);
    const buses = build(c);
    const buf = makeNoise(c);
    if (name === "bgm") {
      const cur = { pos: 0, bar: 0 };
      let t = 0.05;
      for (const n of BGM.notes) t += bgmNote(c, buses.bgm, buf, n, t, cur);
    } else {
      const keep = noiseBuf;
      noiseBuf = buf;
      SFX[name](c, buses.sfx, 0.01, 1);
      noiseBuf = keep;
    }
    return c.startRendering();
  }

  window.SoundManager = {
    play,
    bgm: { start: () => bgm.start(), stop: () => bgm.stop(), get playing() { return bgm.playing; } },
    unlock,
    setMuted,
    toggleMute: () => setMuted(!muted),
    get muted() { return muted; },
    onMuteChange: (f) => { listeners.add(f); return () => listeners.delete(f); },
    get state() { return ctx ? ctx.state : "locked"; },
    names: Object.keys(SFX),
    renderOffline,
  };
})();
