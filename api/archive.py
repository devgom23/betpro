"""
아카이브 — 팀·맞대결에 붙이는 내 판단 태그(최근하락·절대상대 등) 저장소.

계정 본인의 predlog.db(my_picks와 같은 파일, archive_tags 테이블)에 둔다. 스키마·컬럼
설명은 betpro_paths._SCHEMA_ARCHIVE_TAGS 주석 참고. 판정·집계에는 전혀 안 쓰이고,
상세보기 경기지표 뱃지와 아카이브 탭에서 보여주기만 한다.
"""
import sqlite3

import betpro_paths as PATHS

KINDS = ("team", "matchup")
SPANS = ("season", "all")
_EDITABLE = ("tag", "memo", "span", "active")


def _connect(username: str) -> sqlite3.Connection:
    con = sqlite3.connect(PATHS.ensure_predlog_db(username))
    con.row_factory = sqlite3.Row
    return con


def _clean(v) -> str:
    return "" if v is None else str(v).strip()


def list_tags(username: str) -> list[dict]:
    con = _connect(username)
    try:
        rows = con.execute("SELECT * FROM archive_tags ORDER BY id DESC").fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def get_tag(username: str, tag_id: int) -> dict | None:
    con = _connect(username)
    try:
        r = con.execute("SELECT * FROM archive_tags WHERE id=?", (tag_id,)).fetchone()
        return dict(r) if r else None
    finally:
        con.close()


def create_tag(username: str, *, kind: str, scope: str, code: str, team_a: str,
               team_b: str | None, tag: str, memo: str | None, span: str,
               s, r, no, ht: str, at: str) -> int:
    con = _connect(username)
    try:
        cur = con.execute(
            """
            INSERT INTO archive_tags
                (kind, scope, code, team_a, team_b, tag, memo, span, S, R, No, HT, AT,
                 active, created_dt, updated_dt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', 'localtime'),
                    datetime('now', 'localtime'))
            """,
            (kind, scope, code, _clean(team_a), _clean(team_b) or None, _clean(tag),
             _clean(memo) or None, span, _clean(s), _clean(r), _clean(no), _clean(ht), _clean(at)),
        )
        con.commit()
        return int(cur.lastrowid)
    finally:
        con.close()


def update_tag(username: str, tag_id: int, fields: dict) -> bool:
    """fields 중 tag/memo/span/active만 바꾼다(대상 팀·근거 경기는 안 바꾼다 — 바꾸려면
    지우고 새로 단다)."""
    sets = {k: v for k, v in fields.items() if k in _EDITABLE and v is not None}
    if not sets:
        return False
    if "memo" in sets:
        sets["memo"] = _clean(sets["memo"]) or None
    if "tag" in sets:
        sets["tag"] = _clean(sets["tag"])
    if "active" in sets:
        sets["active"] = 1 if sets["active"] else 0
    cols = ", ".join(f"{k}=?" for k in sets)
    con = _connect(username)
    try:
        cur = con.execute(
            f"UPDATE archive_tags SET {cols}, updated_dt=datetime('now', 'localtime') WHERE id=?",
            (*sets.values(), tag_id),
        )
        con.commit()
        return cur.rowcount > 0
    finally:
        con.close()


def delete_tag(username: str, tag_id: int) -> bool:
    con = _connect(username)
    try:
        cur = con.execute("DELETE FROM archive_tags WHERE id=?", (tag_id,))
        con.commit()
        return cur.rowcount > 0
    finally:
        con.close()
