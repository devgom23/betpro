"""
'내 데이터' 스코프의 사용자 정의 리그 관리.

공식 데이터(master)는 6대리그가 고정이지만, 내 데이터는 사용자가 리그를 직접 만들어 쓴다.
그 목록을 계정 본인 DB 안의 등록부 테이블(_user_leagues)에 보관한다.

[코드와 이름을 분리하는 이유]
  code  = 실제 SQLite 테이블명. 'ul_1', 'ul_2' 처럼 자동 생성하고 절대 바꾸지 않는다.
  label = 화면에 보이는 리그 이름. 사용자가 자유롭게 입력·수정한다.
  이름을 그대로 테이블명으로 쓰면 (a) 한글·공백·따옴표가 섞여 SQL 안전성을 매번 따져야 하고
  (b) 이름을 바꾸는 순간 테이블을 갈아치워야 해서 데이터가 위험해진다. 코드를 고정하면
  이름변경이 등록부 한 줄 UPDATE로 끝나고, 업로드 중복판정 키(L/S/R/No/HT/AT)도 흔들리지 않는다.

⚠ 등록부 테이블 이름을 '_'로 시작하게 둔 건 의도적이다 — betpro_paths.league_dashboard()
   같은 기존 집계 함수들이 리그 테이블만 훑도록 되어 있어, 등록부가 리그로 오인되지 않는다.
"""
import os
import re
import sqlite3

REGISTRY_TABLE = "_user_leagues"
CODE_PREFIX = "ul_"

MAX_LABEL_LEN = 30
MAX_LEAGUES = 30          # 탭이 무한정 늘어나 화면이 깨지는 걸 막는 상한

# 자동 생성한 코드만 통과시킨다 — 이 값이 테이블명으로 SQL에 들어가므로 화이트리스트로 검증.
_CODE_RE = re.compile(r"^ul_[1-9][0-9]{0,4}$")


class UserLeagueError(ValueError):
    """리그 생성/수정/삭제 요청이 규칙에 어긋난 경우."""


def is_valid_code(code: str) -> bool:
    return isinstance(code, str) and bool(_CODE_RE.match(code))


def clean_label(label: str) -> str:
    """리그 이름 정리·검증. 한글·영문·숫자·공백 등은 허용하고 제어문자만 막는다."""
    if not isinstance(label, str):
        raise UserLeagueError("리그 이름을 입력해 주세요.")
    text = " ".join(label.split())          # 앞뒤 공백 제거 + 연속 공백 1칸으로
    if not text:
        raise UserLeagueError("리그 이름을 입력해 주세요.")
    if len(text) > MAX_LABEL_LEN:
        raise UserLeagueError(f"리그 이름은 {MAX_LABEL_LEN}자까지 쓸 수 있습니다.")
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in text):
        raise UserLeagueError("리그 이름에 쓸 수 없는 문자가 있습니다.")
    return text


def _connect(db_path: str):
    return sqlite3.connect(db_path)


def _ensure_registry(con) -> None:
    con.execute(
        f'CREATE TABLE IF NOT EXISTS "{REGISTRY_TABLE}" ('
        " code TEXT PRIMARY KEY,"
        " label TEXT NOT NULL,"
        " created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
    )


def list_leagues(db_path: str):
    """[{'code','label'}] — 만든 순서대로. DB가 아직 없으면 빈 목록."""
    if not db_path or not os.path.exists(db_path):
        return []
    con = _connect(db_path)
    try:
        _ensure_registry(con)
        rows = con.execute(
            f'SELECT code, label FROM "{REGISTRY_TABLE}" ORDER BY rowid'
        ).fetchall()
    finally:
        con.close()
    return [{"code": c, "label": l} for c, l in rows if is_valid_code(c)]


def valid_codes(db_path: str) -> set:
    """그 계정이 실제로 만든 리그 코드 집합 — 엔드포인트 접근 검증용."""
    return {lg["code"] for lg in list_leagues(db_path)}


def label_of(db_path: str, code: str) -> str:
    for lg in list_leagues(db_path):
        if lg["code"] == code:
            return lg["label"]
    return code


def _existing_tables(con) -> set:
    return {r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}


def create_league(db_path: str, label: str) -> dict:
    """새 리그를 등록부에 추가하고 빈 코드를 돌려준다(테이블은 첫 업로드 때 생긴다)."""
    text = clean_label(label)
    con = _connect(db_path)
    try:
        _ensure_registry(con)
        rows = con.execute(f'SELECT code, label FROM "{REGISTRY_TABLE}"').fetchall()
        if len(rows) >= MAX_LEAGUES:
            raise UserLeagueError(f"리그는 최대 {MAX_LEAGUES}개까지 만들 수 있습니다.")
        if any(l == text for _, l in rows):
            raise UserLeagueError(f"'{text}' 리그가 이미 있습니다.")

        # 남아 있는 테이블명과도 겹치지 않는 다음 번호를 찾는다
        # (지웠다 다시 만드는 과정에서 번호가 재사용돼 옛 데이터가 붙는 사고를 막는다)
        used = {c for c, _ in rows} | _existing_tables(con)
        n = 1
        while f"{CODE_PREFIX}{n}" in used:
            n += 1
        code = f"{CODE_PREFIX}{n}"
        if not is_valid_code(code):
            raise UserLeagueError("리그를 더 만들 수 없습니다.")

        con.execute(f'INSERT INTO "{REGISTRY_TABLE}" (code, label) VALUES (?, ?)',
                    (code, text))
        con.commit()
    finally:
        con.close()
    return {"code": code, "label": text}


def rename_league(db_path: str, code: str, label: str) -> dict:
    """이름만 바꾼다 — 테이블명(code)은 그대로라 경기 데이터는 전혀 건드리지 않는다."""
    if not is_valid_code(code):
        raise UserLeagueError(f"알 수 없는 리그: {code}")
    text = clean_label(label)
    con = _connect(db_path)
    try:
        _ensure_registry(con)
        rows = con.execute(f'SELECT code, label FROM "{REGISTRY_TABLE}"').fetchall()
        if code not in {c for c, _ in rows}:
            raise UserLeagueError(f"알 수 없는 리그: {code}")
        if any(l == text and c != code for c, l in rows):
            raise UserLeagueError(f"'{text}' 리그가 이미 있습니다.")
        con.execute(f'UPDATE "{REGISTRY_TABLE}" SET label = ? WHERE code = ?', (text, code))
        con.commit()
    finally:
        con.close()
    return {"code": code, "label": text}


def delete_league(db_path: str, code: str) -> dict:
    """등록부에서 지우고 그 리그의 경기 테이블도 함께 드롭한다(되돌릴 수 없음)."""
    if not is_valid_code(code):
        raise UserLeagueError(f"알 수 없는 리그: {code}")
    con = _connect(db_path)
    try:
        _ensure_registry(con)
        hit = con.execute(f'SELECT label FROM "{REGISTRY_TABLE}" WHERE code = ?',
                          (code,)).fetchone()
        if not hit:
            raise UserLeagueError(f"알 수 없는 리그: {code}")
        rows = 0
        if code in _existing_tables(con):
            rows = con.execute(f'SELECT COUNT(*) FROM "{code}"').fetchone()[0]
            con.execute(f'DROP TABLE IF EXISTS "{code}"')
        con.execute(f'DELETE FROM "{REGISTRY_TABLE}" WHERE code = ?', (code,))
        con.commit()
    finally:
        con.close()
    return {"code": code, "label": hit[0], "deleted_rows": rows}
