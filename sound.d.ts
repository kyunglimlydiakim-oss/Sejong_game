// sound.js가 window에 올리는 SoundManager의 타입. TypeScript나 React로 옮길 때 쓴다.
export type SoundName = "coin" | "click" | "levelup" | "gameover" | "hit";

export interface SoundManagerApi {
  /** 효과음 한 번. 오디오가 아직 잠겨 있으면(첫 클릭 전) 아무 일도 하지 않는다. */
  play(name: SoundName, opts?: { volume?: number }): void;
  /** 배경음악(아리랑 후렴). 첫 상호작용 전에 부르면 그때까지 미뤘다가 시작한다. */
  bgm: { start(): void; stop(): void; readonly playing: boolean };
  /** 사용자 제스처 안에서 직접 불러 AudioContext를 깨운다(보통은 자동). */
  unlock(): void;
  setMuted(muted: boolean): void;
  toggleMute(): void;
  readonly muted: boolean;
  /** 음소거 상태가 바뀔 때 불린다. 돌려받은 함수로 구독을 끊는다. */
  onMuteChange(fn: (muted: boolean) => void): () => void;
  readonly state: AudioContextState | "locked";
  readonly names: SoundName[];
  /** 효과음이나 배경음악 한 바퀴("bgm")를 OfflineAudioContext로 렌더링한다(테스트·미리 듣기용). */
  renderOffline(name: SoundName | "bgm", sampleRate?: number): Promise<AudioBuffer>;
}

declare global {
  interface Window {
    SoundManager: SoundManagerApi;
  }
  const SoundManager: SoundManagerApi;
}
