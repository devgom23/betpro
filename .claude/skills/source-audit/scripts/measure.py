"""서버 주소별 응답 시간 측정 — 콜드(처음) · 웜(두 번째)을 재고 느린 순으로 줄 세운다.

실행:  python .claude/skills/source-audit/scripts/measure.py
읽기 전용. 서버를 따로 켤 필요 없음(이 프로세스에서 서버 함수를 직접 부른다).
콜드가 크고 웜이 작으면 '저장해 둔 값이 없을 때만 무거운 것', 웜도 크면 '매번 무거운 것'이다.
"""
import time

from _common import OUT_DIR, body_bytes, endpoints

rows = []
for scr, name, fn in endpoints():
    ts, size, err = [], 0, ""
    for _ in range(2):
        t0 = time.time()
        try:
            size = len(body_bytes(fn()))
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {str(e)[:70]}"
        ts.append((time.time() - t0) * 1000)
    rows.append((scr, name, ts[0], ts[1], size / 1024, err))
    print(f"{scr:<9} {name:<26} 콜드 {ts[0]:>7.0f}ms  웜 {ts[1]:>6.0f}ms  {size/1024:>7.0f}KB {err}", flush=True)

print("\n── 웜(평소) 느린 순 TOP 10 ──")
for scr, name, c, w, kb, err in sorted(rows, key=lambda r: -r[3])[:10]:
    print(f"  {w:>6.0f}ms  {scr} / {name}  (콜드 {c:.0f}ms · {kb:.0f}KB)")
print("\n※ 서버를 막 켠 직후엔 백그라운드 계산(sample-dir 등)이 돌아 웜도 느리게 나온다 — 그럴 땐 몇 분 뒤 다시 잰다.")
print("※ 이 표는 서버 함수 시간이다. 화면 체감(요청 수·겹침)은 브라우저에서 따로 잰다 — SKILL.md 1단계 참고.")
