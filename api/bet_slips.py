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
from my_picks import normalize

# RT 결과와 직접 비교 가능한 핸디캡 계열 픽만 자동판정한다. 축플/축정/정/정무 등
# 다른 마켓은 RT(핸디 결과) 하나만으로는 승패를 알 수 없어 이번 범위에서 제외한다.
HANDI_PICKS = {"핸승", "플핸", "핸무", "무", "역"}

_DT_RE = re.compile(r"(\d{2})-(\d{2})-(\d{2})")


def judge_leg(pick_type: str, rt_label: str | None) -> str:
    """다리 하나의 픽(pick_type)과 실제 결과(rt_label, RT_LABELS 값)를 비교해
    '적중'/'미적중'/'대기'/'취소' 중 하나를 돌려준다."""
    if not rt_label:
        return "대기"
    if rt_label == "취소":
        return "취소"
    if pick_type not in HANDI_PICKS:
        return "대기"
    if pick_type == "핸승":
        return "적중" if rt_label == "핸승" else "미적중"
    if pick_type == "핸무":
        return "적중" if rt_label == "핸무" else "미적중"
    if pick_type == "플핸":
        return "적중" if rt_label != "핸승" else "미적중"
    # 무 / 역
    return "적중" if rt_label == pick_type else "미적중"


def slip_result(leg_results: list[str]) -> str:
    """다리별 판정을 모아 슬립(조합) 전체 결과를 낸다 — 하나라도 미적중이면 전체 미적중."""
    if any(r == "미적중" for r in leg_results):
        return "미적중"
    if any(r == "대기" for r in leg_results):
        return "대기"
    return "적중"


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
                SELECT code, S, R, No, HT, AT, pick_type, odds, leg_order, scope
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


def settle(slips: list[dict], roi_base: str) -> dict:
    """묶음/회차 정산. 수익금 = 적중금합 − 뱃금액합(대기 중인 줄의 투자금도 포함).
    수익률 분모는 스샷 기준을 그대로 따른다 — 등록 묶음은 적중금, 회차 합계는 뱃금액.
    아직 한 줄도 결과가 안 나왔으면(전부 대기) 정산 자체를 하지 않고 공란으로 둔다."""
    stake_sum = sum(s["stake"] or 0 for s in slips)
    hit_sum = sum(s["hit_amount"] or 0 for s in slips)
    settled = any(s["result"] in ("적중", "미적중") for s in slips)
    profit = hit_sum - stake_sum
    base = hit_sum if roi_base == "hit" else stake_sum
    return {
        "stake": stake_sum,
        "hit_amount": hit_sum,
        "profit": profit if settled else None,
        "roi": round(profit / base * 100) if settled and base else None,
    }


def delete_slip(username: str, slip_id: int) -> None:
    con = _connect(username)
    try:
        con.execute("DELETE FROM bet_slips WHERE id=?", (slip_id,))
        con.commit()
    finally:
        con.close()


def delete_batch(username: str, batch_id: str) -> None:
    """등록 묶음을 통째로 지운다 — 이미 회차로 묶인(settle_group_id 있는) 벳은 남긴다."""
    con = _connect(username)
    try:
        con.execute("DELETE FROM bet_slips WHERE batch_id=? AND settle_group_id IS NULL", (batch_id,))
        con.commit()
    finally:
        con.close()


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
