"""
스코어맨을 오래 두드리는 수집을 API 서버 안에서 뒤로 돌린다(2026-09-18 사용자 지정).

  ① 리그 외 경기 일정·결과 수집 — 화면 버튼([리그 외 경기 및 결과 수집]).
     6대리그 팀의 유럽대항전·컵 경기 일정·결과만 받는다(상세보기 '앞뒤 일정'을 만들기 위한 정보).
     ⚠ 2026-09-24 사용자 지정: 배당(12개사·국내배당)은 더 이상 여기서 받지 않는다 —
     cup_odds.db에 쌓기만 하고 읽는 곳이 없었고 수집 시간의 대부분을 차지했다. 리그 경기의
     12개사 배당은 ②가 받는다. api/cup_matches.collect_season(with_odds=False).
  ② 리그 경기 12개사 배당 — '해배 가져오기' 저장 뒤·'최신배당 불러오기' 뒤에 그 경기들만.
     multibook.db에 쌓는다(master.db는 안 건드려서 리그 캐시에 영향이 없다).

[왜 뒤로 돌리나] 경기당 1.2초씩 쉬어 가며 받아야 해서(연속 요청하면 스코어맨이 IP를 막는다)
  수십 경기면 몇 분이 걸린다. 화면 요청이 그동안 붙잡혀 있지 않게 스레드로 돌리고,
  진행 상황은 status()로 따로 읽는다.
[왜 한 줄로 세우나] ①과 ②가 동시에 돌면 요청 간격이 반으로 줄어 막힐 위험이 커진다.
  _SCOREMAN_LOCK 하나로 순서대로 돌게 한다.
⚠ uvicorn --reload로 서버가 다시 뜨면 돌던 작업은 끊긴다. 같은 버튼을 다시 누르면
  이미 받은 것은 건너뛰고 이어서 받는다.
"""
import threading
import time
from datetime import datetime

import cup_matches as CUP
import multibook_odds as MB
import scoreman_odds as SM

GAP = 1.2
_SCOREMAN_LOCK = threading.Lock()

# ① 리그 외 수집 상태 — 화면이 2초마다 읽는다.
_cup = {"running": False, "started": None, "finished": None,
        "lines": [], "result": None, "error": None}
_cup_guard = threading.Lock()

# ② 리그 12개사 — 대기열 길이와 마지막 결과만 둔다.
_books = {"pending": 0, "last": None}
_books_guard = threading.Lock()


def current_season(today: datetime | None = None) -> str:
    """유럽 시즌 표기 — 7월부터 새 시즌('26-27')."""
    d = today or datetime.now()
    y = d.year if d.month >= 7 else d.year - 1
    return f"{y % 100:02d}-{(y + 1) % 100:02d}"


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def cup_status() -> dict:
    with _cup_guard:
        out = dict(_cup)
        out["lines"] = list(_cup["lines"][-8:])
    with _books_guard:
        out["league_books_pending"] = _books["pending"]
    return out


def start_cup(season: str | None = None) -> dict:
    """리그 외 수집을 시작한다. 이미 돌고 있으면 새로 시작하지 않고 지금 상태를 돌려준다."""
    season = season or current_season()
    with _cup_guard:
        if _cup["running"]:
            return {"started": False, "status": _status_unlocked()}
        _cup.update(running=True, started=_now(), finished=None,
                    lines=[f"{season} 시즌 수집 대기 중"], result=None, error=None)

    def log(msg):
        with _cup_guard:
            _cup["lines"].append(str(msg))
            del _cup["lines"][:-200]

    def run():
        try:
            with _SCOREMAN_LOCK:
                log(f"{season} 시즌 수집 시작")
                res = CUP.collect_season(season, with_odds=False, log=log)
            with _cup_guard:
                _cup["result"] = res
        except Exception as e:  # noqa: BLE001 — 어떤 실패든 화면에 사유를 남긴다
            with _cup_guard:
                # RuntimeError는 cup_matches가 사람이 읽으라고 쓴 문장이라 그대로 보여준다.
                _cup["error"] = str(e) if isinstance(e, RuntimeError) else f"{type(e).__name__}: {e}"
        finally:
            with _cup_guard:
                _cup["running"] = False
                _cup["finished"] = _now()

    threading.Thread(target=run, name="cup-collect", daemon=True).start()
    return {"started": True, "status": cup_status()}


def _status_unlocked() -> dict:
    """_cup_guard를 이미 잡은 상태에서 부르는 cup_status."""
    out = dict(_cup)
    out["lines"] = list(_cup["lines"][-8:])
    return out


def queue_league_books(path: str, code: str, items: list[tuple]) -> int:
    """리그 경기들의 12개사 배당(초기·마감)을 뒤에서 받아 multibook.db에 덮어쓴다.
    items: [(S, R, HT, AT, mid), ...] — 팀명은 DB 표기(치환 규칙 적용 후).
    이미 받은 경기도 다시 받는다 — 마감 배당은 경기가 끝나야 확정되기 때문이다."""
    items = [it for it in items if it and it[4]]
    if not items:
        return 0
    with _books_guard:
        _books["pending"] += len(items)

    def run():
        saved = failed = 0
        try:
            with _SCOREMAN_LOCK:
                for s, r, ht, at, mid in items:
                    try:
                        books = SM.match_books(mid)
                        if MB.upsert(path, code, s, r, ht, at, mid, books):
                            saved += 1
                    except SM.OddsError:
                        failed += 1
                    finally:
                        with _books_guard:
                            _books["pending"] -= 1
                    time.sleep(GAP)
        finally:
            with _books_guard:
                _books["last"] = {"code": code, "saved": saved, "failed": failed, "at": _now()}
                drained = _books["pending"] <= 0
            if drained:
                # 12개사 배당이 다 쌓였으면 회사별 방향을 바로 다시 계산해 둔다 — 상세보기를 열 때
                # 저장된 값이 이미 최신이게(2026-09-24 사용자 지정). 늦게 import: 순환 import 방지.
                try:
                    import book_dir
                    book_dir.ensure()
                except Exception:  # noqa: BLE001 — 계산 실패가 수집 결과를 가리면 안 된다
                    pass

    threading.Thread(target=run, name=f"league-books-{code}", daemon=True).start()
    return len(items)
