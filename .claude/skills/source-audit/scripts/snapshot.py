"""결과 값 저장·대조 — 고치기 전/후 서버 응답이 한 글자도 다르지 않은지 확인한다.

실행:
  python .claude/skills/source-audit/scripts/snapshot.py save before    # 고치기 전에 한 번
  (코드 수정)
  python .claude/skills/source-audit/scripts/snapshot.py save after     # 고친 뒤
  python .claude/skills/source-audit/scripts/snapshot.py diff before after

같은 코드로 두 번 저장해 서로 같은지(결정적인지)도 먼저 확인하면 좋다 — 다르면 대조 기준으로 못 쓴다.
저장 위치: 환경변수 AUDIT_OUT 또는 임시 폴더/betpro_audit.
"""
import hashlib
import json
import sys
import time

from _common import OUT_DIR, body_bytes, endpoints

cmd = sys.argv[1] if len(sys.argv) > 1 else ""
if cmd == "save":
    label = sys.argv[2]
    out = {}
    for scr, name, fn in endpoints():
        try:
            t0 = time.time()
            b = body_bytes(fn())
            cold = (time.time() - t0) * 1000
            t0 = time.time()
            body_bytes(fn())
            warm = (time.time() - t0) * 1000
            out[name] = {"sha": hashlib.sha256(b).hexdigest(), "len": len(b), "cold": round(cold), "warm": round(warm)}
            (OUT_DIR / f"snap_{label}__{name.replace('/', '_').replace(' ', '')}.json").write_bytes(b)
            print(f"{name:<26} {len(b):>9}B  콜드 {cold:>6.0f}ms  웜 {warm:>6.0f}ms", flush=True)
        except Exception as e:  # noqa: BLE001
            out[name] = {"error": f"{type(e).__name__}: {str(e)[:80]}"}
            print(f"{name:<26} 오류 {out[name]['error']}")
    (OUT_DIR / f"snap_{label}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n저장: {OUT_DIR}\\snap_{label}.json")
elif cmd == "diff":
    a = json.loads((OUT_DIR / f"snap_{sys.argv[2]}.json").read_text(encoding="utf-8"))
    b = json.loads((OUT_DIR / f"snap_{sys.argv[3]}.json").read_text(encoding="utf-8"))
    diffs = []
    print(f"{'항목':<26} 결과      웜(전→후)ms   콜드(전→후)ms")
    for k in a:
        x, y = a[k], b.get(k, {})
        if "sha" not in x or "sha" not in y:
            print(f"{k:<26} (오류/없음) {x.get('error', '')} → {y.get('error', '없음')}")
            continue
        same = x["sha"] == y["sha"]
        if not same:
            diffs.append(k)
        print(f"{k:<26} {'같음' if same else '다름!':<8} {x['warm']:>6}→{y['warm']:<6}  {x['cold']:>6}→{y['cold']}")
    print("\n결과:", "모든 항목 같음" if not diffs else f"다른 항목 {diffs}")
else:
    print(__doc__)
