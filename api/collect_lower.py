"""2부리그 경기 결과 수집 — 명령 프롬프트에서 따로 돌린다(api/lower_matches.py).

  cd /d C:\\Users\\gomgu\\Desktop\\betpro
  python api\\collect_lower.py EPL              (잉글랜드 2부 챔피언십, 2009-10부터 이번 시즌까지)
  python api\\collect_lower.py EPL 2025-2026    (그 시즌만)

리그 코드: EPL · LALIGA · SERIEA · BUNDES · EREDIVISIE · LIGUE1 (그 나라의 2부를 받는다).
같은 명령을 다시 돌리면 결과·시각이 바뀐 경기를 덮어쓴다.
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import lower_matches as LOW  # noqa: E402


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    code = (args[0] if args else "EPL").upper()
    if code not in LOW.LOWER:
        log(f"리그 코드를 모릅니다: {code} — {', '.join(LOW.LOWER)} 중 하나")
        sys.exit(1)
    only = args[1:] or None
    res = LOW.collect(code, only, log=log)
    log(f"끝 — {res}")
