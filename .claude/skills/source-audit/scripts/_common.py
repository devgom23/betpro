"""소스 점검 스크립트 공용 준비 — 서버 코드를 이 프로세스에서 직접 불러온다.

로그인·네트워크 없이 서버 함수를 직접 호출하므로 DB에 쓰는 함수는 부르지 않는다(읽기 전용 측정).
서버를 따로 띄울 필요도 없고, 미리 읽기(warm-up)도 안 돌아서 첫 호출 = 진짜 콜드다.
"""
import io
import os
import sys
import tempfile
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
ROOT = Path(__file__).resolve().parents[4]          # .claude/skills/source-audit/scripts → 프로젝트 루트
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))
os.chdir(ROOT / "api")

import warnings  # noqa: E402
warnings.filterwarnings("ignore")

import main  # noqa: E402
import betpro_paths as PATHS  # noqa: E402
import data_access as DATA  # noqa: E402
from starlette.responses import Response  # noqa: E402

USER = {"username": "admin", "role": "admin", "expiry": None, "code": "ok", "msg": ""}
OUT_DIR = Path(os.environ.get("AUDIT_OUT") or Path(tempfile.gettempdir()) / "betpro_audit")
OUT_DIR.mkdir(parents=True, exist_ok=True)


def body_bytes(res) -> bytes:
    """응답을 화면이 받는 것과 같은 JSON 바이트로."""
    return res.body if isinstance(res, Response) else main._fast_json(res).body


def sample_match(code="EPL"):
    """측정에 쓸 경기 — 그 리그에서 가장 최근 시즌의 결과 난 마지막 경기(하드코딩하지 않는다)."""
    df = DATA.load_league_df(PATHS.get_master_db(), code)
    done = df[df["RT"].notna()]
    r = done.sort_values(["S", "R"]).iloc[-1]
    return {"code": code, "S": str(r["S"]), "R": str(r["R"]), "HT": r["HT"], "AT": r["AT"],
            "No": str(r["No"]), "DT": str(r["DT"]), "TM": float(r["TM"]) if r["TM"] == r["TM"] else None}


def user_league():
    """내 데이터의 첫 리그 코드(없으면 None)."""
    try:
        codes = main._scope_league_codes(PATHS.SCOPE_USER, USER)
        return codes[0] if codes else None
    except Exception:  # noqa: BLE001
        return None


def endpoints():
    """점검 대상 — (화면, 이름, 호출 함수). 서버 주소가 늘면 여기에 한 줄씩 추가한다."""
    m = sample_match()
    code, S, R, HT, AT, no = m["code"], m["S"], m["R"], m["HT"], m["AT"], m["No"]
    ul = user_league()
    G = [
        ("시즌분석", "season_view", lambda: main.season_view(season="", user=USER)),
        ("리그 화면", "leagues/EPL/filters", lambda: main.league_filters(code, user=USER)),
        ("리그 화면", "leagues/EPL (최근시즌)", lambda: main.league_rows(code, user=USER)),
        ("리그 화면", "leagues/EPL (전체시즌)", lambda: main.league_rows(code, season="ALL", user=USER)),
        ("리그 화면", "season_stats", lambda: main.season_stats(code, user=USER)),
        ("리그 화면", "dashboard", lambda: main.dashboard(user=USER)),
        ("상세보기", "match_detail", lambda: main.match_detail(code, S, R, HT, AT, No=no, user=USER)),
        ("상세보기", "triple_sample", lambda: main.triple_sample(code, S, R, HT, AT, user=USER)),
        ("상세보기", "schedule_context", lambda: main.schedule_context(code, HT, AT, m["DT"], TM=m["TM"], user=USER)),
        ("상세보기", "season_sample", lambda: main.season_sample(code, season=S, round=R, no=float(no), user=USER)),
        ("상세보기", "axis_stats", lambda: main.axis_stats_get(user=USER)),
        ("상세보기", "sample_notes", lambda: main.get_sample_notes(code, season=S, round=R, no=no, ht=HT, at=AT, user=USER)),
        ("상세보기", "sample_card_marks", lambda: main.get_sample_card_marks(code, season=S, round=R, no=no, ht=HT, at=AT, user=USER)),
        ("상세보기", "archive/for_match", lambda: main.archive_for_match(code=code, season=S, round=R, no=no, home=HT, away=AT, user=USER)),
        ("상세보기", "head_to_head", lambda: main.head_to_head(code=code, home=HT, away=AT, user=USER)),
        ("상세보기", "plhan_score", lambda: main.plhan_score_get(code, S, R, HT, AT, user=USER)),
        ("상세보기", "kno_zone", lambda: main.kno_zone_get(code, S, R, HT, AT, user=USER)),
        ("상세보기", "same_odds", lambda: main.same_odds_rounds(rounds=main.SAMEODDS.round_key(m["DT"]) or "", user=USER)),
        # 시즌분석 '라운드별 판정 빗나감'(2026-10-10 추가)
        ("시즌분석", "round_miss", lambda: main.round_miss_summary(user=USER)),
        ("시즌분석", "round_miss/detail", lambda: main.round_miss_detail(code, int("".join(c for c in R if c.isdigit())), user=USER)),
        ("시즌분석", "round_miss/picks", lambda: main.round_miss_picks_get(code, S, int("".join(c for c in R if c.isdigit())), user=USER)),
        ("시즌분석", "round_miss/preds", lambda: main.round_miss_preds_get(code, S, int("".join(c for c in R if c.isdigit())), user=USER)),
        ("이번주 리스트", "week_list", lambda: main.week_list(user=USER)),
        ("이번주 픽", "weekly_picks", lambda: main.weekly_picks(user=USER)),
        ("베팅내역", "bet_slips", lambda: main.list_bet_slips(user=USER)),
        ("아카이브", "archive/odds_bet_picks", lambda: main.archive_odds_bet_picks(user=USER)),
        ("아카이브", "archive/tags", lambda: main.archive_tags(user=USER)),
        ("통합DB", "total/filters", lambda: main.total_filters(user=USER)),
        ("통합DB", "total (전체 표)", lambda: main.total_view(user=USER)),
        ("통합DB", "odds_lookup (조회)", lambda: main.odds_lookup(main.OddsLookupBody(odds={"KW": "2.12", "KD": "3.15", "KL": "3.00"}, tick=3), user=USER)),
        ("통합DB", "odds_lookup (해배평균)", lambda: main.odds_lookup(main.OddsLookupBody(odds={"AW": "1.87", "AD": "3.58", "AL": "3.98"}, tick=3), user=USER)),
        ("통합DB", "odds_lookup/games", lambda: main.odds_lookup_games(q=HT[:2], user=USER)),
        ("상대전적", "teams", lambda: main.teams(user=USER)),
        ("기타경기", "misc_matches", lambda: main.misc_matches_list(user=USER)),
    ]
    if ul:
        G.append(("내 데이터", f"leagues/{ul}", lambda: main.league_rows(ul, scope="user", user=USER)))
        G.append(("내 데이터", "dashboard (내 데이터)", lambda: main.dashboard(scope="user", user=USER)))
    return G
