"""
리그 외 경기(유럽대항전·컵·슈퍼컵) 수집 — 명령 프롬프트에서 따로 돌린다(api/cup_matches.py).

  cd /d C:\\Users\\gomgu\\Desktop\\betpro
  python api\\collect_cups.py 26-27            (일정 + 배당)
  python api\\collect_cups.py 26-27 --no-odds  (일정만)

일정은 매번 새로 받아 덮어쓴다(결과·시각 변경 반영). 배당은 이미 끝난 경기를 받았으면
건너뛰고, 끝나기 전에 받았던 경기는 다시 받는다 — 같은 명령을 주기적으로 돌리면 된다.
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cup_matches as CUP  # noqa: E402


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    season = args[0] if args else "26-27"
    res = CUP.collect_season(season, with_odds="--no-odds" not in sys.argv, log=log)
    log(f"끝 — {res}")
