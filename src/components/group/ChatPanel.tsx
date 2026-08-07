import { useEffect, useRef, useState } from 'react';
import type { RoomMessage } from '../../lib/groupApi';

interface Props {
  messages: RoomMessage[];
  me: string;
  onSend: (body: string) => Promise<{ ok: boolean; error?: string }>;
}

/** 방(로비) 채팅. 게임 중에는 이 컴포넌트 자체를 렌더링하지 않는 방식으로
 *  "게임 중엔 채팅 없음" 요구사항을 지킨다(GroupQuizScreen에서는 이모지 리액션만). */
export default function ChatPanel({ messages, me, onSend }: Props) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  async function submit() {
    const body = input.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    const res = await onSend(body);
    setSending(false);
    if (!res.ok) {
      // 예전엔 실패해도 조용히 삼켜서 메시지가 그냥 증발한 것처럼 보였다 — 이제
      // 입력을 지우지 않고 남겨 둬서(재전송하기 쉽게) 에러만 보여준다.
      setError(res.error ?? '메시지를 보내지 못했습니다.');
      return;
    }
    setInput('');
  }

  return (
    <section className="card chat-panel">
      <h3>채팅</h3>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 ? (
          <p className="muted">아직 메시지가 없습니다. 인사해 보세요!</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`chat-msg ${m.userId === me ? 'mine' : ''}`}>
              <span className="chat-msg-name">{m.displayName}</span>
              <span className="chat-msg-body">{m.body}</span>
            </div>
          ))
        )}
      </div>
      {error && (
        <p className="notice-bar" role="status">
          {error}
        </p>
      )}
      <div className="row chat-input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder="메시지 입력…"
          maxLength={300}
        />
        <button className="btn primary sm" disabled={!input.trim() || sending} onClick={() => void submit()}>
          보내기
        </button>
      </div>
    </section>
  );
}
