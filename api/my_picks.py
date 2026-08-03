"""
"내 예측" — 화면에서 직접 표시한 중요 별표(⭐) / 실제 벳팅 픽(내픽).
계정 본인의 predlog.db(prediction_log와 같은 파일, 별도 테이블)에 저장한다.
리그 표 자체(to_sql replace)와 분리되어 있어 재업로드·재계산에 영향받지 않는다.
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
    """해당 리그(code)+스코프에서 이 계정이 표시한 별표/내픽/적중여부/메모 전부."""
    con = _connect(username)
    try:
        rows = con.execute(
            "SELECT S, R, No, HT, AT, starred, pick, hit, memo FROM my_picks WHERE code=? AND scope=?",
            (code, scope),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def upsert_my_pick(username: str, code: str, scope: str,
                    s: str, r: str, no: str, ht: str, at: str,
                    starred: bool, pick: str | None, hit: str | None, memo: str | None) -> None:
    con = _connect(username)
    try:
        con.execute(
            """
            INSERT INTO my_picks (code, scope, S, R, No, HT, AT, starred, pick, hit, memo, updated_dt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(code, scope, S, R, No, HT, AT)
            DO UPDATE SET starred = excluded.starred, pick = excluded.pick, hit = excluded.hit,
                          memo = excluded.memo, updated_dt = excluded.updated_dt
            """,
            (code, scope, normalize(s), normalize(r), normalize(no), normalize(ht), normalize(at),
             1 if starred else 0, pick or None, hit or None, memo or None),
        )
        con.commit()
    finally:
        con.close()
