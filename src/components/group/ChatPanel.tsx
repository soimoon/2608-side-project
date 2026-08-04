import { useEffect, useRef, useState } from 'react';
import type { RoomMessage } from '../../lib/groupApi';

interface Props {
  messages: RoomMessage[];
  me: string;
  onSend: (body: string) => void;
}

/** 방(로비) 채팅. 게임 중에는 이 컴포넌트 자체를 렌더링하지 않는 방식으로
 *  "게임 중엔 채팅 없음" 요구사항을 지킨다(GroupQuizScreen에서는 이모지 리액션만). */
export default function ChatPanel({ messages, me, onSend }: Props) {
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  function submit() {
    const body = input.trim();
    if (!body) return;
    onSend(body);
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
      <div className="row chat-input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="메시지 입력…"
          maxLength={300}
        />
        <button className="btn primary sm" disabled={!input.trim()} onClick={submit}>
          보내기
        </button>
      </div>
    </section>
  );
}
