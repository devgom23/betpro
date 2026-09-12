"""
"내 예측" — 화면에서 직접 표시한 중요 별표(⭐) / 실제 벳팅 픽(내픽).
계정 본인의 predlog.db(prediction_log와 같은 파일, 별도 테이블)에 저장한다.
리그 표 자체(to_sql replace)와 분리되어 있어 재업로드·재계산에 영향받지 않는다.

starred는 2026-08-30부터 3단계다: 0=표시 없음 / 1=반개(보류·고민중) / 2=온별(중요).
예전엔 boolean이라 1이 곧 '중요'였다 — 그 값을 새 체계에서 반개로 잘못 읽지 않도록
betpro_paths.ensure_predlog_db()가 PRAGMA user_version으로 한 번만 1→2로 옮긴다.
"이번주 벳" 목록에는 2(온별)만 들어간다(main.py weekly_picks) — 반개는 아직 확정
전이라 조합에 안 섞는다.

reason_tag: 결과반성용 "왜 이렇게 봤나" 태그(1개, pickOptions.js REASON_TAG_OPTIONS
중 하나). pick(무엇을 걸지)과 반드시 분리한다 — 판정(_MY_PICK_VERDICT_MAP)이
pick 문자열을 정확히 매칭해 적중/보험/미적을 가르므로, 여기 태그를 섞으면 안 된다.

memo_pre vs memo: memo_pre는 경기 전에 적는 메모, memo는 결과가 나온 뒤 적는
회고 메모 — 시점이 다른 별개 글이라 컬럼을 나눈다.
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
            "SELECT S, R, No, HT, AT, starred, pick, p, hit, memo, memo_pre, reason_tag, wp_hidden "
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
                    starred: int, pick: str | None, hit: str | None, memo: str | None,
                    p: str | None = None, reason_tag: str | None = None,
                    memo_pre: str | None = None) -> None:
    con = _connect(username)
    try:
        con.execute(
            """
            INSERT INTO my_picks
                (code, scope, S, R, No, HT, AT, starred, pick, p, hit, memo, memo_pre, reason_tag, wp_hidden, updated_dt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
            ON CONFLICT(code, scope, S, R, No, HT, AT)
            DO UPDATE SET starred = excluded.starred, pick = excluded.pick, p = excluded.p,
                          hit = excluded.hit, memo = excluded.memo, memo_pre = excluded.memo_pre,
                          reason_tag = excluded.reason_tag,
                          wp_hidden = 0, updated_dt = excluded.updated_dt
            """,
            (code, scope, normalize(s), normalize(r), normalize(no), normalize(ht), normalize(at),
             max(0, min(2, int(starred or 0))), pick or None, p or None, hit or None, memo or None,
             memo_pre or None, reason_tag or None),
        )
        con.commit()
    finally:
        con.close()


def get_season_note(username: str, code: str, scope: str, s: str, r: str) -> str | None:
    """'시즌 지표 ③ 과거 이력'에 단 메모 — 경기 하나가 아니라 리그+시즌+라운드 하나에 1개뿐."""
    con = _connect(username)
    try:
        row = con.execute(
            "SELECT memo FROM season_notes WHERE code=? AND scope=? AND S=? AND R=?",
            (code, scope, normalize(s), normalize(r)),
        ).fetchone()
        return row["memo"] if row else None
    finally:
        con.close()


def _ensure_top20(con) -> None:
    """이번주 TOP15 명단 — 회차(시작~종료일)+갈래(정무/플핸무)별로 '직전에 몇 위였나'를
    기억해 두는 표. 순위 계산 자체는 매번 화면(web/src/utils/weekTop20.js)이 결과(RT)와
    무관하게 새로 한다(2026-09-12) — 여기 저장된 값은 더 이상 "후보 자격"이 아니라,
    직전 순위 대비 등락 화살표(3(1▼) 형태)를 보여주기 위한 기준선일 뿐이다.
    match_key는 화면이 만든 문자열을 그대로 저장한다(top20Key).

    2026-09-11: 정무만 몰려서(85.92% 칸이 정무 독식) 플핸무가 순위에 아예 안 보이는 문제로
    정무 TOP15 / 플핸무 TOP15 두 갈래로 나눴다(kind 컬럼 추가, 2026-09-12 TOP10→TOP15).
    기존 테이블에는 없던 컬럼이라 ALTER로 보강한다 — 이미 있으면(재실행) 조용히 건너뛴다."""
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS week_top20 (
            week_start TEXT NOT NULL,
            week_end   TEXT NOT NULL,
            match_key  TEXT NOT NULL,
            rank       INTEGER,
            updated_dt TEXT,
            PRIMARY KEY (week_start, week_end, match_key)
        )
        """
    )
    try:
        con.execute("ALTER TABLE week_top20 ADD COLUMN kind TEXT")
    except sqlite3.OperationalError:
        pass


def list_top20(username: str, start: str, end: str, kind: str) -> list[str]:
    con = _connect(username)
    try:
        _ensure_top20(con)
        rows = con.execute(
            "SELECT match_key FROM week_top20 WHERE week_start=? AND week_end=? AND kind=? ORDER BY rank",
            (start, end, kind),
        ).fetchall()
        return [r["match_key"] for r in rows]
    finally:
        con.close()


def save_top20(username: str, start: str, end: str, kind: str, keys: list[str]) -> None:
    """그 회차·갈래(정무/플핸무)의 명단을 통째로 바꾼다(순위 밖으로 밀린 경기는 여기서 빠진다).
    다른 갈래의 명단은 건드리지 않는다."""
    con = _connect(username)
    try:
        _ensure_top20(con)
        con.execute("DELETE FROM week_top20 WHERE week_start=? AND week_end=? AND kind=?", (start, end, kind))
        con.executemany(
            "INSERT INTO week_top20 (week_start, week_end, match_key, rank, updated_dt, kind) "
            "VALUES (?, ?, ?, ?, datetime('now'), ?)",
            [(start, end, k, i + 1, kind) for i, k in enumerate(keys)],
        )
        con.commit()
    finally:
        con.close()


def upsert_season_note(username: str, code: str, scope: str, s: str, r: str, memo: str | None) -> None:
    con = _connect(username)
    try:
        con.execute(
            """
            INSERT INTO season_notes (code, scope, S, R, memo, updated_dt)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(code, scope, S, R)
            DO UPDATE SET memo = excluded.memo, updated_dt = excluded.updated_dt
            """,
            (code, scope, normalize(s), normalize(r), memo or None),
        )
        con.commit()
    finally:
        con.close()
