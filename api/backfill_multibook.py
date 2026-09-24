"""
스코어맨 12개사 배당 과거 백필 — 명령 프롬프트에서 따로 돌린다(API 서버와 무관).

  cd /d C:\\Users\\gomgu\\Desktop\\betpro
  python api\\backfill_multibook.py 24-25 25-26 26-27

- 시즌을 안 주면 24-25 25-26 26-27.
- 이미 받은 경기는 건너뛰므로 중간에 끊겨도 같은 명령으로 이어서 받는다.
- 요청 사이 1.2초. 스코어맨이 막으면(연속 실패) 5분 쉬고 다시 시도한다 —
  예전에 150번 연속 요청 후 IP가 한동안 막힌 적이 있다(main.py refresh_final_odds 주석).
- 저장은 data/master/multibook.db (master.db는 건드리지 않는다, multibook_odds.py 참고).
"""
import os
import re
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import betpro_paths as PATHS  # noqa: E402
import crawler as CRAWL  # noqa: E402
import data_access as DATA  # noqa: E402
import multibook_odds as MB  # noqa: E402
import scoreman_odds as SM  # noqa: E402
from kr_extra_odds import _key  # noqa: E402

ADMIN = "admin"
GAP = 1.2
FAIL_PAUSE = 300


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def scoreman_season(season: str) -> str:
    m = re.match(r"^(\d{2})-(\d{2})$", str(season).strip())
    if not m:
        return str(season).strip()
    full = lambda y: 2000 + int(y) if int(y) < 80 else 1900 + int(y)  # noqa: E731
    return f"{full(m.group(1))}-{full(m.group(2))}"


def main(seasons):
    udb = PATHS.get_user_db(ADMIN)
    mdb = PATHS.get_master_db()
    out_path = MB.db_path_for(PATHS.SCOPE_MASTER)
    total_saved = total_skip = total_unmatched = 0
    for code in PATHS.LEAGUES:
        src = CRAWL.get_source(udb, PATHS.SCOPE_MASTER, code) or ""
        m = re.search(r"/league/(\d+)", src)
        if not m:
            log(f"{code}: 스코어맨 리그 주소 없음 — 건너뜀")
            continue
        league_id = int(m.group(1))
        aliases = CRAWL.list_aliases(udb, PATHS.SCOPE_MASTER, code)
        df = DATA.load_league_df(mdb, code)
        for season in seasons:
            sub = df[df["S"].astype(str).str.strip() == season]
            if sub.empty:
                continue
            sched = []
            for attempt in range(1, 6):
                # 스코어맨이 일정 파일을 잠깐 거부하면 빈 목록이 온다 — 그대로 두면 그 시즌 전체가
                # '일정에서 못 찾음'으로 조용히 건너뛰어지므로(2026-09-24 시험에서 실제로 0경기가 나왔다)
                # 몇 번 다시 받아 본다.
                sched = CRAWL.apply_aliases(SM.season_schedule(league_id, scoreman_season(season)), aliases)
                if sched:
                    break
                log(f"{code} {season}: 일정 파일이 비어 있음 — {attempt}/5회, 30초 뒤 다시")
                time.sleep(30)
            if not sched:
                log(f"{code} {season}: ⚠ 일정 파일을 끝내 못 받음 — 이 시즌은 건너뜀(같은 명령을 다시 실행하면 이어서 받음)")
                continue
            mid_of = {(str(g["HT"]).strip(), str(g["AT"]).strip()): g["mid"] for g in sched}
            done = MB.done_keys(out_path, code, season)
            todo, unmatched = [], []
            for _, r in sub.iterrows():
                ht, at = str(r["HT"]).strip(), str(r["AT"]).strip()
                if _key(code, r["S"], r["R"], ht, at) in done:
                    total_skip += 1
                    continue
                mid = mid_of.get((ht, at))
                if mid:
                    todo.append((r["S"], r["R"], ht, at, mid))
                else:
                    unmatched.append(f"{ht}-{at}")
            total_unmatched += len(unmatched)
            log(f"{code} {season}: 받을 경기 {len(todo)} · 이미 받음 {len(done)} · 일정에서 못 찾음 {len(unmatched)}"
                + (f" (예: {', '.join(unmatched[:3])})" if unmatched else ""))
            fails = 0
            for i, (s, rr, ht, at, mid) in enumerate(todo, 1):
                while True:
                    try:
                        books = SM.match_books(mid)
                        fails = 0
                        break
                    except SM.OddsError as e:
                        fails += 1
                        if fails >= 3:
                            log(f"연속 실패 {fails}회({e}) — {FAIL_PAUSE // 60}분 쉬고 다시 시도")
                            time.sleep(FAIL_PAUSE)
                        else:
                            time.sleep(5)
                total_saved += 1 if MB.upsert(out_path, code, s, rr, ht, at, mid, books) else 0
                if i % 50 == 0 or i == len(todo):
                    log(f"  {code} {season} {i}/{len(todo)}")
                time.sleep(GAP)
    log(f"끝 — 새로 저장 {total_saved}경기 · 건너뜀(이미 받음) {total_skip} · 일정에서 못 찾음 {total_unmatched}")


if __name__ == "__main__":
    main(sys.argv[1:] or ["24-25", "25-26", "26-27"])
