"""
"베팅내역" — 여러 경기를 묶은 조합베팅(파를레이) 등록/조회.
my_picks.py와 마찬가지로 계정별 predlog.db에 저장해 리그 표 재업로드·재계산에
영향받지 않는다. 실제 경기 결과(RT) 조회는 리그 df를 읽어야 하므로 api/main.py에서
수행하고, 이 모듈은 슬립 저장/조회와 순수 판정 로직(judge_leg)만 담당한다.
"""
import re
import sqlite3
import uuid
from datetime import date, timedelta

import betpro_paths as PATHS
import kr_extra_odds as KXODDS
from my_picks import normalize

# RT 결과와 직접 비교 가능한 핸디캡 계열 픽만 자동판정한다. 정무 등 다른 마켓은
# RT(핸디 결과) 하나만으로는 승패를 알 수 없어 이번 범위에서 제외한다.
HANDI_PICKS = {"핸승", "플핸", "핸무", "무", "역", "정"}

_DT_RE = re.compile(r"(\d{2})-(\d{2})-(\d{2})")

# 적중특례 — 그 다리는 맞고 틀림을 따지지 않고 배당 1.0으로 정산한다(국내 토토 규칙).
# 2026-09-18 사용자 지정: 연기 경기도 '다시 열릴 때까지 대기'가 아니라 바로 특례 처리한다
# (라리가 26-27 6R 레반테/빌바오 — 플핸 1.48 × 정 2.02 조합이 1.48로 정산).
VOID_RESULTS = ("연기", "취소")


def judge_leg(pick_type: str, rt_label: str | None) -> str:
    """다리 하나의 픽(pick_type)과 실제 결과(rt_label, RT_LABELS 값)를 비교해
    '적중'/'미적중'/'대기'/'연기'/'취소' 중 하나를 돌려준다."""
    if not rt_label:
        return "대기"
    if rt_label in VOID_RESULTS:
        return rt_label
    if pick_type not in HANDI_PICKS:
        return "대기"
    if pick_type == "정":
        # 정배가 실제로 이겼으면 적중(핸승=2점차+ 승, 핸무=정확히 1점차 승 — 둘 다 정배의 승리).
        return "적중" if rt_label in ("핸승", "핸무") else "미적중"
    if pick_type == "핸승":
        return "적중" if rt_label == "핸승" else "미적중"
    if pick_type == "핸무":
        return "적중" if rt_label == "핸무" else "미적중"
    if pick_type == "플핸":
        return "적중" if rt_label in ("무", "역") else "미적중"
    # 무 / 역
    return "적중" if rt_label == pick_type else "미적중"


def judge_extra_leg(pick_type: str, rt_label: str | None, hs, as_, handi_line) -> str:
    """추가배당 유형(2핸승·3.5플핸·2.5언더 등) 다리 판정 — 취소·연기·결과 전 처리는
    judge_leg와 같고, 결과가 나온 경기는 스코어로 판정한다(kr_extra_odds.judge)."""
    if not rt_label:
        return "대기"
    if rt_label in VOID_RESULTS:
        return rt_label
    return KXODDS.judge(pick_type, hs, as_, handi_line) or "대기"


def slip_result(leg_results: list[str]) -> str:
    """다리별 판정을 모아 슬립(조합) 전체 결과를 낸다 — 하나라도 미적중이면 전체 미적중.
    적중특례(연기·취소) 다리는 결과에서 빼고 본다 — 나머지가 다 맞으면 적중이다.
    다리가 전부 특례면 배당 1.0짜리 적중(=뱃금액 그대로 돌려받음)이다."""
    live = [r for r in leg_results if r not in VOID_RESULTS]
    if any(r == "미적중" for r in live):
        return "미적중"
    if any(r == "대기" for r in live):
        return "대기"
    return "적중"


def effective_odds(slip_odds: float | None, legs: list[dict]) -> float | None:
    """적중특례 다리를 1.0으로 바꿔 다시 곱한 조합 배당. 특례 다리가 없으면 등록 배당 그대로.
    다리별 배당이 비어 있는 옛날 벳은 다시 곱할 수 없어 등록 배당을 그대로 둔다."""
    if not any(l.get("hit") in VOID_RESULTS for l in legs):
        return slip_odds
    vals = []
    for l in legs:
        if l.get("hit") in VOID_RESULTS:
            continue
        if not l.get("odds"):
            return slip_odds
        vals.append(l["odds"])
    return combo_odds(vals) if vals else 1.0


def save_void_status(username: str, leg_status: list[tuple[int, str]]) -> None:
    """처음 적중특례를 본 다리에 그 사실을 굳혀 둔다(bet_slip_legs.void_status).
    연기 경기가 나중에 다시 열려 RT가 1~4로 바뀌어도 이 다리는 특례 그대로 남는다."""
    if not leg_status:
        return
    con = _connect(username)
    try:
        con.executemany(
            "UPDATE bet_slip_legs SET void_status=? WHERE id=? AND void_status IS NULL",
            [(status, leg_id) for leg_id, status in leg_status],
        )
        con.commit()
    finally:
        con.close()


def _round_range(dt_str: str) -> tuple[date, date]:
    """DT('YY-MM-DD (Day)')를 그 경기가 속한 베팅 회차(금~월)로 변환한다.
    화/수/목 경기는 그 주에 이미 지나간 금~월이 아니라 다가올 금~월 회차에 귀속시킨다."""
    m = _DT_RE.search(str(dt_str))
    if not m:
        raise ValueError(f"알 수 없는 DT 형식: {dt_str!r}")
    yy, mm, dd = (int(v) for v in m.groups())
    d = date(2000 + yy, mm, dd)
    weekday = d.weekday()  # Mon=0 ... Sun=6
    if weekday in (4, 5, 6):  # Fri, Sat, Sun
        friday = d - timedelta(days=weekday - 4)
    elif weekday == 0:  # Mon
        friday = d - timedelta(days=3)
    else:  # Tue(1), Wed(2), Thu(3) -> 다가올 금요일 회차
        friday = d + timedelta(days=4 - weekday)
    return friday, friday + timedelta(days=3)


def _connect(username: str) -> sqlite3.Connection:
    path = PATHS.ensure_predlog_db(username)
    con = sqlite3.connect(path)
    con.execute("PRAGMA foreign_keys=ON;")
    con.row_factory = sqlite3.Row
    return con


def combo_odds(leg_odds: list[float | None]) -> float | None:
    """조합 배당 = 각 다리 배당의 곱 (예: 1.94 × 1.89 = 3.67)."""
    vals = [o for o in leg_odds if o]
    if not vals:
        return None
    total = 1.0
    for o in vals:
        total *= o
    return round(total, 2)


def create_batch(username: str, scope: str, bets: list[dict], memo: str | None) -> str:
    """"벳등록" 한 번 = 조합 여러 줄을 한 묶음(batch_id)으로 저장한다.
    수익금·수익률이 이 묶음 단위(그 한 번에 투자한 금액)로 정산되기 때문에 함께 묶는다."""
    if not bets:
        raise ValueError("등록할 조합이 없습니다.")
    batch_id = uuid.uuid4().hex[:12]
    con = _connect(username)
    try:
        for bet in bets:
            legs = bet["legs"]
            if not legs:
                raise ValueError("조합에 최소 한 경기가 필요합니다.")
            round_start, round_end = _round_range(legs[0]["DT"])
            odds = bet.get("odds") or combo_odds([l.get("odds") for l in legs])
            cur = con.execute(
                """
                INSERT INTO bet_slips
                    (batch_id, scope, round_start, round_end, odds, stake, memo, created_dt)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
                """,
                (batch_id, scope, round_start.isoformat(), round_end.isoformat(),
                 odds, bet.get("stake"), memo or None),
            )
            slip_id = cur.lastrowid
            for i, leg in enumerate(legs):
                con.execute(
                    """
                    INSERT INTO bet_slip_legs
                        (slip_id, code, S, R, No, HT, AT, pick_type, odds, leg_order, scope)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (slip_id, leg["code"],
                     normalize(leg.get("S")), normalize(leg.get("R")), normalize(leg.get("No")),
                     normalize(leg.get("HT")), normalize(leg.get("AT")),
                     leg["pick_type"], leg.get("odds"), i, leg.get("scope") or scope),
                )
        con.commit()
        return batch_id
    finally:
        con.close()


def list_slips(username: str, scope: str) -> list[dict]:
    """슬립+다리 원본 데이터(등록된 값 그대로, 실제 RT/판정 없음)를 등록된 순서(id) 그대로 반환한다.
    회차는 더 이상 날짜로 자동 묶지 않고 settle_group_id(=연속된 값끼리)로 구간을 나눈다."""
    con = _connect(username)
    try:
        slips = con.execute(
            """
            SELECT id, batch_id, scope, round_start, round_end, odds, stake, memo, created_dt, settle_group_id
            FROM bet_slips WHERE scope=?
            ORDER BY id ASC
            """,
            (scope,),
        ).fetchall()
        out = []
        for s in slips:
            legs = con.execute(
                """
                SELECT id AS leg_id, code, S, R, No, HT, AT, pick_type, odds, leg_order, scope, void_status
                FROM bet_slip_legs WHERE slip_id=? ORDER BY leg_order
                """,
                (s["id"],),
            ).fetchall()
            row = dict(s)
            row["legs"] = [dict(l) for l in legs]
            out.append(row)
        return out
    finally:
        con.close()


def list_slips_all(username: str) -> list[dict]:
    """스코프(master/user) 구분 없이 이 계정의 모든 벳 슬립+다리를 등록 순서(id) 그대로 반환한다.
    "이 팀을 지금까지 몇 번 벳 선택에 넣었는지"(team_bet_record)처럼 회차·스코프와 무관하게
    전체 배팅 이력을 훑어야 할 때 쓴다 — list_slips와 달리 scope로 거르지 않는다."""
    con = _connect(username)
    try:
        slips = con.execute(
            """
            SELECT id, batch_id, scope, round_start, round_end, odds, stake, memo, created_dt, settle_group_id
            FROM bet_slips
            ORDER BY id ASC
            """
        ).fetchall()
        out = []
        for s in slips:
            legs = con.execute(
                """
                SELECT id AS leg_id, code, S, R, No, HT, AT, pick_type, odds, leg_order, scope, void_status
                FROM bet_slip_legs WHERE slip_id=? ORDER BY leg_order
                """,
                (s["id"],),
            ).fetchall()
            row = dict(s)
            row["legs"] = [dict(l) for l in legs]
            out.append(row)
        return out
    finally:
        con.close()


def settle(slips: list[dict]) -> dict:
    """묶음/회차 정산. 수익금 = 적중금합 − 뱃금액합(대기 중인 줄의 투자금도 포함).
    수익률 = 수익금 ÷ 뱃금액(투자한 돈 대비 얼마 벌었나) — 등록 묶음·회차 합계 모두 동일.
    아직 한 줄도 결과가 안 나왔으면(전부 대기) 정산 자체를 하지 않고 공란으로 둔다."""
    stake_sum = sum(s["stake"] or 0 for s in slips)
    hit_sum = sum(s["hit_amount"] or 0 for s in slips)
    settled = any(s["result"] in ("적중", "미적중") for s in slips)
    profit = hit_sum - stake_sum
    return {
        "stake": stake_sum,
        "hit_amount": hit_sum,
        "profit": profit if settled else None,
        "roi": round(profit / stake_sum * 100) if settled and stake_sum else None,
    }


def delete_slips(username: str, scope: str, slip_ids: list[int]) -> int:
    """체크박스로 고른 벳들을 지운다 — 이미 회차로 묶인 벳은 걸러지고 그대로 남는다.
    반환값은 실제로 지워진 행 수(이번주 픽 "선택 삭제"와 같은 방식)."""
    if not slip_ids:
        return 0
    con = _connect(username)
    try:
        placeholders = ",".join("?" for _ in slip_ids)
        cur = con.execute(
            f"DELETE FROM bet_slips WHERE scope=? AND settle_group_id IS NULL AND id IN ({placeholders})",
            (scope, *slip_ids),
        )
        con.commit()
        return cur.rowcount
    finally:
        con.close()


def lock_slips(username: str, scope: str, slip_ids: list[int]) -> str:
    """체크박스로 고른 벳들을 하나의 회차로 확정한다("회차 설정"). 이미 묶인 벳은 건드리지
    않는다. 반환값은 새로 만든 묶음 id — 회차총계 구간을 식별하는 데 쓴다."""
    if not slip_ids:
        raise ValueError("선택된 벳이 없습니다.")
    group_id = uuid.uuid4().hex[:12]
    con = _connect(username)
    try:
        placeholders = ",".join("?" for _ in slip_ids)
        cur = con.execute(
            f"""
            UPDATE bet_slips SET settle_group_id=?
            WHERE scope=? AND settle_group_id IS NULL AND id IN ({placeholders})
            """,
            (group_id, scope, *slip_ids),
        )
        con.commit()
        if cur.rowcount == 0:
            raise ValueError("선택된 벳이 이미 다른 회차에 포함되었거나 존재하지 않습니다.")
        return group_id
    finally:
        con.close()
