# -*- coding: utf-8 -*-
"""
WEB_BET PRO V1.0 - 마이그레이션 스크립트
================================================================================
기존 통합 DB(data/Soccer_History.db) 를 4-DB 컨테이너 구조로 분리한다.

    data/Soccer_History.db          (기존: 전부 한 파일)
        +- users                ->  auth.db                        (1)
        +- EPL, LALIGA, ...     ->  data/master/master.db          (2)
        +- prediction_log       ->  data/users/{admin}/predlog.db  (4)

■ 안전 원칙
    - 원본(Soccer_History.db)은 절대 수정/삭제하지 않는다. 읽기만 한다.
      -> 실패해도 언제든 되돌릴 수 있다. 확인 후 수동 삭제 권장.
    - master.db 는 tmp 에 빌드 후 os.replace() 로 원자적 스왑.
    - 기존 파일이 있으면 자동 백업 후 진행.
    - --dry 로 미리보기 가능 (아무것도 안 바꿈).

■ 사용법
    python betpro_migrate.py --dry     # 미리보기 (권장: 먼저 실행)
    python betpro_migrate.py           # 실제 이관
    python betpro_migrate.py --force   # 대상 DB에 데이터가 있어도 덮어씀
"""

import os
import sys
import shutil
import sqlite3
import datetime
from typing import List, Optional, Tuple

import betpro_paths as PATHS


# =============================================================
# 리포트
# =============================================================

class MigrateReport:
    def __init__(self):
        self.legacy_path = ""
        self.legacy_exists = False
        self.leagues: List[Tuple[str, int, int]] = []   # (리그, 원본행, 이관행)
        self.users_moved = 0
        self.predlog_moved = 0
        self.predlog_owner = ""
        self.skipped_tables: List[str] = []
        self.errors: List[str] = []
        self.warnings: List[str] = []
        self.dry = False

    @property
    def total_rows(self) -> int:
        return sum(m for _, _, m in self.leagues)

    @property
    def ok(self) -> bool:
        return not self.errors

    def render(self) -> str:
        L = []
        head = "[미리보기 - 아무것도 변경하지 않음]" if self.dry else "[이관 완료]"
        L.append("=" * 68)
        L.append(f"  {PATHS.APP_NAME} {PATHS.APP_VERSION} 마이그레이션  {head}")
        L.append("=" * 68)
        L.append(f"원본: {self.legacy_path}")
        L.append("")

        if self.leagues:
            L.append("(2) master.db - 리그 데이터")
            L.append(f"   {'리그':<12}{'원본':>10}{'이관':>10}")
            L.append("   " + "-" * 32)
            for lg, src, dst in self.leagues:
                mark = "" if src == dst else "  ⚠"
                L.append(f"   {PATHS.LEAGUE_LABEL.get(lg, lg):<12}{src:>10,}{dst:>10,}{mark}")
            L.append("   " + "-" * 32)
            L.append(f"   {'합계':<12}{'':>10}{self.total_rows:>10,}")
        else:
            L.append("(2) master.db - 이관할 리그 데이터 없음")
        L.append("")

        L.append(f"(1) auth.db       - 계정 {self.users_moved}개 이관")
        if self.predlog_moved:
            L.append(f"(4) predlog.db    - 예측로그 {self.predlog_moved}건 -> "
                     f"'{self.predlog_owner}' 계정")
        else:
            L.append("(4) predlog.db    - 이관할 예측로그 없음")

        if self.skipped_tables:
            L.append("")
            L.append(f"건너뛴 테이블: {', '.join(self.skipped_tables)}")

        for w in self.warnings:
            L.append(f"⚠  {w}")
        for e in self.errors:
            L.append(f"❌ {e}")

        L.append("")
        if self.dry:
            L.append("-> 실제 이관: python betpro_migrate.py")
        elif self.ok:
            L.append("✅ 이관 성공. 원본 Soccer_History.db 는 그대로 보존됩니다.")
            L.append("   앱 정상 동작을 확인한 뒤 수동으로 삭제하세요.")
        L.append("=" * 68)
        return "\n".join(L)


# =============================================================
# 유틸
# =============================================================

def _tables(db_path: str) -> List[str]:
    if not os.path.exists(db_path):
        return []
    con = sqlite3.connect(db_path)
    try:
        return [r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    finally:
        con.close()


def _count(con: sqlite3.Connection, table: str) -> int:
    try:
        return con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    except sqlite3.Error:
        return 0


def _backup_if_exists(path: str) -> Optional[str]:
    """기존 파일이 있으면 타임스탬프 백업."""
    if not os.path.exists(path):
        return None
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    dst = f"{path}.bak_{ts}"
    shutil.copy2(path, dst)
    return dst


def _copy_table(src_con: sqlite3.Connection, dst_path: str,
                table: str, dry: bool = False) -> int:
    """
    💡 [업데이트 내용] 테이블 통째 복사 - 스키마 고정 없이.
    기존 리그 테이블은 산출 컬럼(FW 1~4 ... 프로그램 예측 등 150여개)까지
    포함하므로, CREATE 문을 원본에서 그대로 가져와 재현한다.
    컬럼 목록을 하드코딩하면 본체(to_sql)와 어긋나 깨진다.
    """
    n = _count(src_con, table)
    if dry or n == 0:
        return n

    row = src_con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
    if not row or not row[0]:
        return 0
    create_sql = row[0]

    dst_con = sqlite3.connect(dst_path)
    try:
        dst_con.execute("PRAGMA journal_mode=WAL;")
        dst_con.execute(f'DROP TABLE IF EXISTS "{table}"')
        dst_con.execute(create_sql)

        cols = [d[1] for d in src_con.execute(f'PRAGMA table_info("{table}")').fetchall()]
        col_sql = ", ".join(f'"{c}"' for c in cols)
        ph = ", ".join(["?"] * len(cols))

        cur = src_con.execute(f'SELECT {col_sql} FROM "{table}"')
        while True:
            batch = cur.fetchmany(2000)
            if not batch:
                break
            dst_con.executemany(
                f'INSERT INTO "{table}" ({col_sql}) VALUES ({ph})', batch)
        dst_con.commit()
        return _count(dst_con, table)
    finally:
        dst_con.close()


# =============================================================
# (1) 계정 이관
# =============================================================

def migrate_auth(src_con: sqlite3.Connection, rep: MigrateReport, dry: bool) -> None:
    """
    💡 [업데이트 내용] users 테이블 -> auth.db 분리.
    기존엔 계정이 Soccer_History.db 안에 있어서
    master 재빌드 시 전 고객 계정이 소멸하는 구조였다.
    betpro_auth.py 는 무수정 - 본체가 넘기는 db_path 만 바뀐다.
    """
    if "users" not in _tables(rep.legacy_path):
        rep.warnings.append("원본에 users 테이블이 없습니다. 기본 관리자가 새로 생성됩니다.")
        return

    n = _count(src_con, "users")
    rep.users_moved = n
    if dry or n == 0:
        return

    auth_db = PATHS.get_auth_db()
    bak = _backup_if_exists(auth_db)
    if bak:
        rep.warnings.append(f"기존 auth.db 백업: {os.path.basename(bak)}")

    _copy_table(src_con, auth_db, "users", dry=False)


# =============================================================
# (2) 리그 데이터 이관
# =============================================================

def migrate_master(src_con: sqlite3.Connection, rep: MigrateReport,
                   dry: bool, force: bool) -> None:
    """
    💡 [업데이트 내용] 리그 테이블 -> master.db 승격.
    tmp 에 전부 빌드한 뒤 os.replace() 로 원자적 스왑 ->
    고객이 조회 중이어도 깨지지 않는다.
    스키마는 원본 CREATE 문을 그대로 재현 (산출 컬럼 보존).
    """
    src_tables = set(_tables(rep.legacy_path))
    found = [lg for lg in PATHS.LEAGUES if lg in src_tables]

    if not found:
        rep.warnings.append("원본에 6대 리그 테이블이 하나도 없습니다.")
        return

    master_db = PATHS.get_master_db()
    if not force and PATHS.db_total_rows(master_db) > 0:
        rep.errors.append(
            f"master.db 에 이미 {PATHS.db_total_rows(master_db):,}건이 있습니다. "
            "덮어쓰려면 --force 를 붙이세요.")
        return

    if dry:
        for lg in found:
            n = _count(src_con, lg)
            rep.leagues.append((lg, n, n))
        return

    tmp = PATHS.get_master_tmp_db()
    if os.path.exists(tmp):
        os.remove(tmp)

    con_tmp = sqlite3.connect(tmp)
    try:
        con_tmp.execute("PRAGMA journal_mode=WAL;")
        con_tmp.commit()
    finally:
        con_tmp.close()

    for lg in found:
        src_n = _count(src_con, lg)
        dst_n = _copy_table(src_con, tmp, lg, dry=False)
        rep.leagues.append((lg, src_n, dst_n))
        if src_n != dst_n:
            rep.errors.append(f"{lg}: 원본 {src_n:,} != 이관 {dst_n:,} - 이관 중단")

    if rep.errors:
        if os.path.exists(tmp):
            os.remove(tmp)
        return

    PATHS.swap_master(tmp)          # 백업 + 원자적 스왑
    PATHS.stamp_updated(PATHS.get_master_db())


# =============================================================
# (4) 예측 로그 이관
# =============================================================

def migrate_predlog(src_con: sqlite3.Connection, rep: MigrateReport,
                    owner: str, dry: bool) -> None:
    """
    💡 [업데이트 내용] prediction_log -> 개인 predlog.db 로 이관.
    기존 로그는 소유자 개념이 없으므로(단일 사용자 시절) 관리자 계정에 귀속시킨다.
    성적표는 데이터와 운명을 갈라놓는다 -> user.db 가 아닌 별도 파일.
    """
    if "prediction_log" not in _tables(rep.legacy_path):
        return

    n = _count(src_con, "prediction_log")
    rep.predlog_moved = n
    rep.predlog_owner = owner
    if dry or n == 0:
        return

    if not PATHS.is_valid_username(owner):
        rep.warnings.append(
            f"'{owner}' 는 폴더명으로 쓸 수 없어 예측로그를 건너뜁니다. "
            "(영문/숫자/_/- 3~32자만 허용)")
        rep.predlog_moved = 0
        return

    PATHS.ensure_user_space(owner)
    dst = PATHS.get_predlog_db(owner)
    bak = _backup_if_exists(dst)
    if bak:
        rep.warnings.append(f"기존 predlog.db 백업: {os.path.basename(bak)}")

    _copy_table(src_con, dst, "prediction_log", dry=False)
    PATHS.ensure_predlog_db(owner)   # UNIQUE 제약 등 스키마 보정


# =============================================================
# 메인
# =============================================================

def run(dry: bool = False, force: bool = False, owner: str = "admin") -> MigrateReport:
    rep = MigrateReport()
    rep.dry = dry
    rep.legacy_path = PATHS.LEGACY_DB
    rep.legacy_exists = os.path.exists(PATHS.LEGACY_DB)

    PATHS.bootstrap()

    if not rep.legacy_exists:
        rep.errors.append(
            f"기존 DB가 없습니다: {PATHS.LEGACY_DB}\n"
            "   이관할 것이 없다면 이 스크립트는 실행하지 않아도 됩니다.")
        return rep

    # 읽기전용 open - 원본 불가침
    src_con = sqlite3.connect(f"file:{PATHS.LEGACY_DB}?mode=ro", uri=True)
    try:
        all_t = set(_tables(rep.legacy_path))
        known = set(PATHS.LEAGUES) | {"users", "prediction_log", "meta", "sqlite_sequence"}
        rep.skipped_tables = sorted(all_t - known)

        migrate_master(src_con, rep, dry, force)
        if rep.errors:
            return rep
        migrate_auth(src_con, rep, dry)
        migrate_predlog(src_con, rep, owner, dry)
    except Exception as e:
        rep.errors.append(f"{type(e).__name__}: {e}")
    finally:
        src_con.close()

    return rep


if __name__ == "__main__":
    args = sys.argv[1:]
    _dry = "--dry" in args
    _force = "--force" in args

    _owner = "admin"
    for a in args:
        if a.startswith("--owner="):
            _owner = a.split("=", 1)[1].strip()

    _rep = run(dry=_dry, force=_force, owner=_owner)
    print()
    print(_rep.render())
    sys.exit(0 if _rep.ok else 1)
