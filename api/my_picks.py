"""
"내 예측" — 화면에서 직접 표시한 중요 별표(⭐) / 실제 벳팅 픽(내픽).
계정 본인의 predlog.db(prediction_log와 같은 파일, 별도 테이블)에 저장한다.
리그 표 자체(to_sql replace)와 분리되어 있어 재업로드·재계산에 영향받지 않는다.

reason_tag: 결과반성용 "왜 이렇게 봤나" 태그(1개, pickOptions.js REASON_TAG_OPTIONS
중 하나). pick(무엇을 걸지)과 반드시 분리한다 — 판정(_MY_PICK_VERDICT_MAP)이
pick 문자열을 정확히 매칭해 적중/보험/미적을 가르므로, 여기 태그를 섞으면 안 된다.
"""
import sqlite3

import betpro_paths as PATHS


def normalize(v) -> str:
    """매칭 키 정규화. No처럼 같은 값이 저장 경로에선 '1'(int), 조회 경로에선
    1.0(DataFrame float 컬럼) 으로 서로 다른 타입으로 오가도 같은 키가 되게 맞춘다."""
    if v is None:
        return ""
    try:
        f = float(v)
        return str(int(f)) if f.is_integer() else str(f)
    except (TypeError, ValueError):
        return str(v).strip()


def _connect(username: str) -> sqlite3.Connection:
    path = PATHS.ensure_predlog_db(username)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    return con


def list_my_picks(username: str, code: str, scope: str) -> list[dict]:
    """해당 리그(code)+스코프에서 이 계정이 표시한 별표/내픽/P태그/적중여부/메모 전부."""
    con = _connect(username)
    try:
        rows = con.execute(
            "SELECT S, R, No, HT, AT, starred, pick, p, hit, memo, reason_tag, wp_hidden "
            "FROM my_picks WHERE code=? AND scope=?",
            (code, scope),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def hide_from_weekly_picks(username: str, items: list[dict]) -> int:
    """골라준 경기들을 "이번주 픽" 화면에서만 숨긴다. 별표(starred)는 그대로 두므로
    리그 표의 ★ 표시·적중 기록은 안 바뀐다 — "선택 삭제"에서 쓴다.
    반환값은 실제로 숨겨진 행 수."""
    con = _connect(username)
    try:
        cur = con.cursor()
        n = 0
        for it in items:
            cur.execute(
                """
                UPDATE my_picks SET wp_hidden = 1, updated_dt = datetime('now')
                WHERE code=? AND scope=? AND S=? AND R=? AND No=? AND HT=? AND AT=?
                """,
                (it["code"], it["scope"], normalize(it["S"]), normalize(it["R"]), normalize(it["No"]),
                 normalize(it["HT"]), normalize(it["AT"])),
            )
            n += cur.rowcount
        con.commit()
        return n
    finally:
        con.close()


def upsert_my_pick(username: str, code: str, scope: str,
                    s: str, r: str, no: str, ht: str, at: str,
                    starred: bool, pick: str | None, hit: str | None, memo: str | None,
                    p: str | None = None, reason_tag: str | None = None) -> None:
    con = _connect(username)
    try:
        con.execute(
            """
            INSERT INTO my_picks
                (code, scope, S, R, No, HT, AT, starred, pick, p, hit, memo, reason_tag, wp_hidden, updated_dt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
            ON CONFLICT(code, scope, S, R, No, HT, AT)
            DO UPDATE SET starred = excluded.starred, pick = excluded.pick, p = excluded.p,
                          hit = excluded.hit, memo = excluded.memo, reason_tag = excluded.reason_tag,
                          wp_hidden = 0, updated_dt = excluded.updated_dt
            """,
            (code, scope, normalize(s), normalize(r), normalize(no), normalize(ht), normalize(at),
             1 if starred else 0, pick or None, p or None, hit or None, memo or None, reason_tag or None),
        )
        con.commit()
    finally:
        con.close()
