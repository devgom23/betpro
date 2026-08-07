"""
"베팅내역" — 여러 경기를 묶은 조합베팅(파를레이) 등록/조회.
my_picks.py와 마찬가지로 계정별 predlog.db에 저장해 리그 표 재업로드·재계산에
영향받지 않는다. 실제 경기 결과(RT) 조회는 리그 df를 읽어야 하므로 api/main.py에서
수행하고, 이 모듈은 슬립 저장/조회와 순수 판정 로직(judge_leg)만 담당한다.
"""
import re
import sqlite3
from datetime import date, datetime, timedelta

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


def create_slip(username: str, scope: str, legs: list[dict],
                 odds: float | None, stake: int | None, memo: str | None) -> int:
    if not legs:
        raise ValueError("최소 한 개 이상의 경기가 필요합니다.")
    round_start, round_end = _round_range(legs[0]["DT"])
    con = _connect(username)
    try:
        cur = con.execute(
            """
            INSERT INTO bet_slips (scope, round_start, round_end, odds, stake, memo, created_dt)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            """,
            (scope, round_start.isoformat(), round_end.isoformat(), odds, stake, memo or None),
        )
        slip_id = cur.lastrowid
        for i, leg in enumerate(legs):
            con.execute(
                """
                INSERT INTO bet_slip_legs (slip_id, code, S, R, No, HT, AT, pick_type, leg_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (slip_id, leg["code"],
                 normalize(leg.get("S")), normalize(leg.get("R")), normalize(leg.get("No")),
                 normalize(leg.get("HT")), normalize(leg.get("AT")),
                 leg["pick_type"], i),
            )
        con.commit()
        return slip_id
    finally:
        con.close()


def list_slips(username: str, scope: str) -> list[dict]:
    """슬립+다리 원본 데이터(등록된 값 그대로, 실제 RT/판정 없음)를 최신 회차부터 반환한다."""
    con = _connect(username)
    try:
        slips = con.execute(
            """
            SELECT id, scope, round_start, round_end, odds, stake, memo, created_dt
            FROM bet_slips WHERE scope=? ORDER BY round_start DESC, created_dt DESC
            """,
            (scope,),
        ).fetchall()
        out = []
        for s in slips:
            legs = con.execute(
                """
                SELECT code, S, R, No, HT, AT, pick_type, leg_order
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


def delete_slip(username: str, slip_id: int) -> None:
    con = _connect(username)
    try:
        con.execute("DELETE FROM bet_slips WHERE id=?", (slip_id,))
        con.commit()
    finally:
        con.close()
