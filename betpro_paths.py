# -*- coding: utf-8 -*-
"""
WEB_BET PRO V1.0 - 경로/DB 해석 단일 진입점
================================================================================
모든 DB 경로 결정은 이 모듈을 통해서만 이루어진다.
본체(WEB_BET_PRO.py)는 절대 경로를 직접 조립하지 않는다.

■ 4-DB 컨테이너 구조 (생명주기가 다르면 파일을 나눈다)
    auth.db                          (1) 계정 - 절대 불가침
         +- users
    data/master/master.db            (2) 공식 분석 데이터 - 관리자만 쓰기
         +- EPL, LALIGA, SERIEA, BUNDES, EREDIVISIE, LIGUE1
    data/master/backup/              +- master_YYYYMMDD_HHMMSS.db (최근 5개)
    data/users/{username}/user.db    (3) 개인 업로드 데이터 (동일 스키마)
    data/users/{username}/predlog.db (4) 개인 예측 로그 - 성적표, 데이터와 운명 분리
    data/access_log.db               (5) 관리자 열람 기록 (C안)

■ 권한 매트릭스
    관리자 : master(RW) / 타 고객 user(R, 열람만) / auth(RW)
    고객   : master(R)  / 본인 user(RW)          / 타 고객(불가)

■ 핵심 원칙
    - 리그 테이블 스키마는 기존 Soccer_History.db 구조를 그대로 유지
      -> _prep_db(), get_samples_fast(), analyze_dataframe(), ProgramPredictor18
         엔진 4종을 단 한 줄도 수정하지 않는다.
    - 스코프 격리: 통합지표(13~17번)도 자기 스코프 DB 안에서만 산출.
      master 탭 -> master.db / 내 데이터 탭 -> user.db
"""

import os
import re
import shutil
import sqlite3
import datetime
from typing import List, Optional, Dict

# =============================================================
# 상수
# =============================================================

APP_NAME = "WEB_BET PRO"
APP_VERSION = "V1.0"

# 💡 [업데이트 내용] 리그 코드 = 테이블명 체계 (기존 본체 LEAGUES 와 동일)
LEAGUES: List[str] = ['EPL', 'LALIGA', 'SERIEA', 'BUNDES', 'EREDIVISIE', 'LIGUE1']
VALID_LEAGUES = set(LEAGUES)

LEAGUE_LABEL: Dict[str, str] = {
    "EPL": "EPL",
    "LALIGA": "라리가",
    "SERIEA": "세리에A",
    "BUNDES": "분데스",
    "EREDIVISIE": "에레디",
    "LIGUE1": "리그1",
}
LEAGUE_ORDER = LEAGUES

# 💡 [업데이트 내용] 원본 엑셀 L 컬럼값(2글자 코드) -> 테이블명 매핑
#    실측: EPL='EP' / 라리가='La' / 세리에='SA' / 분데스='BD' / 에레디='Er' / 리그1='L1'
#    (라리가 파일에 'ㄴ' 오타 1건 존재 -> 매핑 실패로 자동 드롭)
L_CODE_TO_TABLE: Dict[str, str] = {
    "EP": "EPL",
    "La": "LALIGA",
    "SA": "SERIEA",
    "BD": "BUNDES",
    "Er": "EREDIVISIE",
    "L1": "LIGUE1",
}

SCOPE_MASTER = "master"
SCOPE_USER = "user"
SCOPE_LABEL = {SCOPE_MASTER: "📊 공식 데이터", SCOPE_USER: "👤 내 데이터"}

# 계정명 화이트리스트 - 경로 탈출(../) 원천 차단
_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_-]{3,32}$")

BACKUP_KEEP = 5

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR = os.path.join(_BASE_DIR, "data")
_MASTER_DIR = os.path.join(_DATA_DIR, "master")
_BACKUP_DIR = os.path.join(_MASTER_DIR, "backup")
_USERS_DIR = os.path.join(_DATA_DIR, "users")

# 기존 통합 DB (마이그레이션 원본)
LEGACY_DB = os.path.join(_DATA_DIR, "Soccer_History.db")


# =============================================================
# 계정명 검증
# =============================================================

class InvalidUsernameError(ValueError):
    """계정명이 파일시스템 안전 규칙을 위반한 경우."""
    pass


def validate_username(username: str) -> str:
    """
    파일시스템에 직접 노출되는 값이므로 화이트리스트로만 통과시킨다.
    블랙리스트('../' 제거 등)는 우회 가능하므로 사용하지 않는다.
    """
    if not isinstance(username, str):
        raise InvalidUsernameError("계정명은 문자열이어야 합니다.")
    u = username.strip()
    if not _USERNAME_RE.match(u):
        raise InvalidUsernameError(
            f"허용되지 않는 계정명입니다: '{username}'\n"
            "영문/숫자/언더스코어/하이픈 3~32자만 사용 가능합니다."
        )
    return u


def is_valid_username(username: str) -> bool:
    try:
        validate_username(username)
        return True
    except InvalidUsernameError:
        return False


# =============================================================
# 경로 해석
# =============================================================

def get_data_dir() -> str:
    return _DATA_DIR


def get_auth_db() -> str:
    """
    💡 [업데이트 내용] (1) 계정 DB 분리.
    기존엔 users 테이블이 Soccer_History.db 안에 있어서
    master 재빌드/롤백 시 전 고객 계정이 소멸하는 구조였다.
    별도 파일로 분리 -> master 를 몇 번 갈아엎어도 계정은 무사.
    betpro_auth.py 는 db_path 인자를 받으므로 무수정으로 동작한다.
    """
    return os.path.join(_BASE_DIR, "auth.db")


def get_master_dir() -> str:
    return _MASTER_DIR


def get_master_db() -> str:
    """(2) 공식 데이터. 관리자만 쓰기, 전 계정 읽기 공유."""
    return os.path.join(_MASTER_DIR, "master.db")


def get_master_tmp_db() -> str:
    """재빌드용 임시 DB. 완성 후 os.replace() 로 원자적 스왑."""
    return os.path.join(_MASTER_DIR, "master.tmp.db")


def get_backup_dir() -> str:
    return _BACKUP_DIR


def get_users_dir() -> str:
    return _USERS_DIR


def get_user_dir(username: str) -> str:
    u = validate_username(username)
    return os.path.join(_USERS_DIR, u)


def get_user_db(username: str) -> str:
    """(3) 개인 업로드 데이터. 본인 RW / 관리자 R(열람만)."""
    return os.path.join(get_user_dir(username), "user.db")


def get_predlog_db(username: str) -> str:
    """
    💡 [업데이트 내용] (4) 예측 로그 분리.
    prediction_log 는 "경기 전에 찍은 픽이 실제 몇 % 맞았나"를 증명하는
    조작 불가능한 성적표 = 상품 신뢰의 근거.
    user.db 안에 두면 고객이 데이터를 갈아엎을 때 성적표까지 날아간다.
    파일을 분리해 데이터와 운명을 갈라놓는다.
    """
    return os.path.join(get_user_dir(username), "predlog.db")


def get_access_log_db() -> str:
    """(5) 관리자 열람 기록 (C안). 분쟁 시 근거."""
    return os.path.join(_DATA_DIR, "access_log.db")


def resolve_db(scope: str, username: Optional[str] = None) -> str:
    """
    탭 라우팅용 통합 해석기. 본체는 이 함수만 호출한다.
        scope="master" -> master.db
        scope="user"   -> users/{username}/user.db
    """
    if scope == SCOPE_MASTER:
        return get_master_db()
    if scope == SCOPE_USER:
        if not username:
            raise ValueError("scope='user' 인 경우 username 이 필요합니다.")
        return get_user_db(username)
    raise ValueError(f"알 수 없는 scope: {scope!r} (master|user 만 허용)")


def can_write(scope: str, role: str) -> bool:
    """
    💡 [업데이트 내용] 권한 매트릭스.
    - master : 관리자만 쓰기
    - user   : 본인만 쓰기 (관리자도 타 고객 데이터는 열람만, 수정 불가)
    호출부에서 scope 가 user 인 경우는 이미 본인 DB 로 해석되므로 True.
    """
    if scope == SCOPE_MASTER:
        return role == "admin"
    if scope == SCOPE_USER:
        return True
    return False


def list_usernames() -> List[str]:
    """개인 데이터 폴더가 존재하는 계정 목록."""
    if not os.path.isdir(_USERS_DIR):
        return []
    out = []
    for name in sorted(os.listdir(_USERS_DIR)):
        p = os.path.join(_USERS_DIR, name)
        if os.path.isdir(p) and is_valid_username(name):
            out.append(name)
    return out


# =============================================================
# 스키마
# =============================================================

# 💡 [업데이트 내용] 리그 테이블은 CREATE 하지 않는다 (의도적).
#   기존 본체가 df_final.to_sql(league, if_exists='replace') 로
#   산출 컬럼(FW 1~4 ... TKWDL 4, K_NH_SHARE, 프로그램 예측 1~4 등 150여개)까지
#   통째로 저장하는 구조. 스키마를 고정하면 오히려 본체가 깨진다.
#   -> 파일만 만들어두고 테이블 생성은 본체(to_sql)에 맡긴다. 코어 보존.

_SCHEMA_PREDICTION_LOG = """
CREATE TABLE IF NOT EXISTS prediction_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pred_dt TEXT,
    league TEXT, S TEXT, R TEXT, No TEXT,
    HT TEXT, AT TEXT,
    pick18 TEXT, grade18 TEXT, ph19 TEXT, combo20 TEXT,
    FW REAL, FD REAL, FL REAL,
    RT INTEGER,
    hit18 INTEGER, hit19 INTEGER, hit20 INTEGER,
    graded_dt TEXT,
    UNIQUE(league, S, R, No, HT, AT)
)
"""

_SCHEMA_META = """
CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT
)
"""

# "내 예측" — 화면에서 직접 표시한 중요 별표 / 실제 벳팅 픽. 리그 표(to_sql replace)와
# 완전히 분리된 predlog.db에 둬서, 엑셀 재업로드·재계산으로 리그 테이블이 통째로
# 교체되어도 이 기록은 그대로 남는다.
_SCHEMA_MY_PICKS = """
CREATE TABLE IF NOT EXISTS my_picks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    scope TEXT NOT NULL,
    S TEXT NOT NULL,
    R TEXT NOT NULL,
    No TEXT NOT NULL,
    HT TEXT NOT NULL,
    AT TEXT NOT NULL,
    starred INTEGER NOT NULL DEFAULT 0,
    pick TEXT,
    hit TEXT,
    memo TEXT,
    -- 이번주 픽 화면에서만 숨긴다("선택 삭제"). starred는 그대로라 리그 표의 별표는 안 꺼진다.
    wp_hidden INTEGER NOT NULL DEFAULT 0,
    updated_dt TEXT,
    UNIQUE(code, scope, S, R, No, HT, AT)
)
"""

# 조합베팅(파를레이) 등록 내역 — my_picks와 마찬가지로 리그 표와 분리된 predlog.db에 둔다.
# 한 슬립(bet_slips)이 여러 경기 다리(bet_slip_legs)를 갖고, 각 다리는 어느 리그(code)
# 소속인지 함께 저장해서(교차 리그 조합 가능) 실제 결과(RT) 조회 시 리그별로 찾아간다.
#
# batch_id: "이번주 벳"에서 벳등록 한 번에 만들어진 조합들을 하나로 묶는 값.
#   수익금·수익률이 이 묶음(그 한 번에 투자한 금액) 단위로 정산되므로 반드시 필요하고,
#   베팅내역 표에서도 등록 묶음끼리 구분선으로 나눠 보여주는 기준이 된다.
_SCHEMA_BET_SLIPS = """
CREATE TABLE IF NOT EXISTS bet_slips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT,
    scope TEXT NOT NULL,
    round_start TEXT NOT NULL,
    round_end TEXT NOT NULL,
    odds REAL,
    stake INTEGER,
    memo TEXT,
    created_dt TEXT NOT NULL,
    -- "회차 설정" 버튼으로 사용자가 직접 고른 벳들을 하나로 묶을 때만 채워진다.
    -- NULL이면 아직 회차로 확정되지 않은 상태(선택 삭제·회차 설정 둘 다 가능).
    settle_group_id TEXT
)
"""

# odds: 그 다리 하나의 배당(예: 김포 플핸 1.94). 조합 배당(bet_slips.odds)은 이 값들의 곱이다.
_SCHEMA_BET_SLIP_LEGS = """
CREATE TABLE IF NOT EXISTS bet_slip_legs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slip_id INTEGER NOT NULL REFERENCES bet_slips(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    S TEXT, R TEXT, No TEXT, HT TEXT, AT TEXT,
    pick_type TEXT NOT NULL,
    odds REAL,
    leg_order INTEGER NOT NULL,
    -- 이 다리가 실제로 속한 리그의 스코프(master/user). 이번주 픽은 공식·내 데이터를
    -- 섞어서 조합을 만들 수 있어, 슬립 전체의 scope(등록 화면 기준)만으론 이 다리가
    -- 어느 DB에 있는지 알 수 없다 — 결과(RT) 조회 시 반드시 이 값을 써야 한다.
    scope TEXT
)
"""

_SCHEMA_ACCESS_LOG = """
CREATE TABLE IF NOT EXISTS access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    admin_id TEXT NOT NULL,
    target_user TEXT NOT NULL,
    league TEXT,
    action TEXT,
    rows INTEGER
)
"""


def _touch_db(db_path: str) -> None:
    """DB 파일 존재 보장 (리그 테이블 생성 없음)."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    con = sqlite3.connect(db_path)
    try:
        con.execute("PRAGMA journal_mode=WAL;")
        con.execute(_SCHEMA_META)
        con.commit()
    finally:
        con.close()


def ensure_master_db() -> str:
    """master.db 존재 보장. 앱 부팅 시 1회."""
    os.makedirs(_MASTER_DIR, exist_ok=True)
    os.makedirs(_BACKUP_DIR, exist_ok=True)
    p = get_master_db()
    _touch_db(p)
    return p


def ensure_predlog_db(username: str) -> str:
    """개인 예측로그 DB 존재 + 스키마 보장."""
    p = get_predlog_db(username)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    con = sqlite3.connect(p)
    try:
        con.execute("PRAGMA journal_mode=WAL;")
        con.execute(_SCHEMA_PREDICTION_LOG)
        con.execute(_SCHEMA_MY_PICKS)
        # 기존에 만들어진 my_picks 테이블엔 memo/hit 컬럼이 없을 수 있어 안전하게 보강한다.
        cols = {r[1] for r in con.execute("PRAGMA table_info(my_picks)").fetchall()}
        if "memo" not in cols:
            con.execute("ALTER TABLE my_picks ADD COLUMN memo TEXT")
        if "hit" not in cols:
            con.execute("ALTER TABLE my_picks ADD COLUMN hit TEXT")
        if "wp_hidden" not in cols:
            con.execute("ALTER TABLE my_picks ADD COLUMN wp_hidden INTEGER NOT NULL DEFAULT 0")
        con.execute("PRAGMA foreign_keys=ON;")
        con.execute(_SCHEMA_BET_SLIPS)
        con.execute(_SCHEMA_BET_SLIP_LEGS)
        # my_picks와 같은 방식으로, 먼저 만들어진 표에 뒤에 추가된 컬럼을 보강한다.
        slip_cols = {r[1] for r in con.execute("PRAGMA table_info(bet_slips)").fetchall()}
        if "batch_id" not in slip_cols:
            con.execute("ALTER TABLE bet_slips ADD COLUMN batch_id TEXT")
        if "settle_group_id" not in slip_cols:
            con.execute("ALTER TABLE bet_slips ADD COLUMN settle_group_id TEXT")
        leg_cols = {r[1] for r in con.execute("PRAGMA table_info(bet_slip_legs)").fetchall()}
        if "odds" not in leg_cols:
            con.execute("ALTER TABLE bet_slip_legs ADD COLUMN odds REAL")
        if "scope" not in leg_cols:
            con.execute("ALTER TABLE bet_slip_legs ADD COLUMN scope TEXT")
        con.commit()
    finally:
        con.close()
    return p


def ensure_user_space(username: str) -> str:
    """개인 폴더 + user.db + predlog.db 존재 보장. 로그인 직후 호출."""
    u = validate_username(username)
    os.makedirs(get_user_dir(u), exist_ok=True)
    _touch_db(get_user_db(u))
    ensure_predlog_db(u)
    return get_user_dir(u)


def ensure_access_log_db() -> str:
    p = get_access_log_db()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    con = sqlite3.connect(p)
    try:
        con.execute(_SCHEMA_ACCESS_LOG)
        con.commit()
    finally:
        con.close()
    return p


# =============================================================
# 계정 생명주기 훅 (betpro_auth.py 는 무수정 - 본체에서 호출)
# =============================================================

def on_account_created(username: str) -> str:
    """계정 생성 직후. 폴더 + user.db + predlog.db 초기화."""
    return ensure_user_space(username)


def on_account_deleted(username: str) -> bool:
    """
    계정 삭제 직후. 개인 폴더 통째 삭제.
    ⚠ 되돌릴 수 없음 - 본체에서 확인 모달 통과 후에만 호출.
    """
    u = validate_username(username)
    d = get_user_dir(u)
    # 안전장치: 반드시 users 디렉터리 하위여야 삭제
    if not os.path.abspath(d).startswith(os.path.abspath(_USERS_DIR) + os.sep):
        raise InvalidUsernameError(f"삭제 경로가 users 디렉터리를 벗어납니다: {d}")
    if os.path.isdir(d):
        shutil.rmtree(d, ignore_errors=False)
        return True
    return False


# 💡 [업데이트 내용] 만료는 로그인 차단만. 데이터 보존 -> 연장 시 즉시 복원.
#    별도 훅 없음(의도적). betpro_auth 의 만료 판정만으로 충분.


# =============================================================
# 캐시 무효화 키
# =============================================================

def db_mtime(db_path: str) -> float:
    """
    캐시 키용 mtime. 파일 없으면 0.0.
    st.cache_data 키에 (db_path, mtime) 을 넣으면
      - master 갱신 -> 전 고객 캐시 자동 무효화 (브로드캐스트 불필요)
      - 개인 업로드 -> 본인 캐시만 갱신
    """
    try:
        return os.path.getmtime(db_path)
    except OSError:
        return 0.0


def cache_key(scope: str, username: Optional[str] = None):
    p = resolve_db(scope, username)
    return (p, db_mtime(p))


# =============================================================
# 마스터 백업 / 원자적 스왑
# =============================================================

def backup_master() -> Optional[str]:
    """master.db 타임스탬프 백업. 최근 BACKUP_KEEP 개만 보관."""
    src = get_master_db()
    if not os.path.exists(src):
        return None
    os.makedirs(_BACKUP_DIR, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    dst = os.path.join(_BACKUP_DIR, f"master_{ts}.db")
    shutil.copy2(src, dst)
    _rotate_backups()
    return dst


def list_backups() -> List[str]:
    """최신순 백업 파일 경로 목록."""
    if not os.path.isdir(_BACKUP_DIR):
        return []
    files = [
        os.path.join(_BACKUP_DIR, f)
        for f in os.listdir(_BACKUP_DIR)
        if f.startswith("master_") and f.endswith(".db")
    ]
    return sorted(files, key=os.path.getmtime, reverse=True)


def _rotate_backups() -> None:
    for old in list_backups()[BACKUP_KEEP:]:
        try:
            os.remove(old)
        except OSError:
            pass


def swap_master(tmp_path: str) -> None:
    """
    재빌드된 tmp DB -> master.db 원자적 교체.
    os.replace 는 동일 볼륨에서 원자적 -> 고객이 조회 중이어도 깨지지 않는다.
    """
    if not os.path.exists(tmp_path):
        raise FileNotFoundError(f"임시 DB가 없습니다: {tmp_path}")
    backup_master()
    os.replace(tmp_path, get_master_db())


def restore_backup(backup_path: str) -> None:
    """백업 -> master.db 롤백."""
    ap = os.path.abspath(backup_path)
    if not os.path.exists(ap):
        raise FileNotFoundError(f"백업 파일이 없습니다: {backup_path}")
    if not ap.startswith(os.path.abspath(_BACKUP_DIR) + os.sep):
        raise ValueError("백업 디렉터리 외부 파일은 복원할 수 없습니다.")
    tmp = get_master_tmp_db()
    shutil.copy2(ap, tmp)
    os.replace(tmp, get_master_db())


# =============================================================
# 대시보드 - 리그별 현황
# =============================================================

def list_tables(db_path: str) -> List[str]:
    """DB 내 테이블 목록."""
    if not os.path.exists(db_path):
        return []
    con = sqlite3.connect(db_path)
    try:
        return [r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    except sqlite3.Error:
        return []
    finally:
        con.close()


def table_row_count(db_path: str, table: str) -> int:
    """특정 테이블의 행 수. 테이블이 없거나 읽기 실패면 0."""
    if not os.path.exists(db_path) or table not in set(list_tables(db_path)):
        return 0
    con = sqlite3.connect(db_path)
    try:
        return con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    except sqlite3.Error:
        return 0
    finally:
        con.close()


def league_dashboard(db_path: str) -> List[dict]:
    """
    💡 [업데이트 내용] 리그별 업로드 현황 대시보드.
    경기수 / 시즌범위 / 결과보유(RT) / 예정경기 / 국내배당 보유 건수.
    master 탭 / 내 데이터 탭 / 마스터 관리 탭 / 계정관리 탭이 공용으로 쓴다.
    """
    if not os.path.exists(db_path):
        return []
    tabs = set(list_tables(db_path))
    con = sqlite3.connect(db_path)
    out = []
    try:
        for lg in LEAGUES:
            if lg not in tabs:
                out.append({
                    "리그": LEAGUE_LABEL[lg], "코드": lg, "경기수": 0,
                    "시즌": "-", "결과보유": 0, "예정": 0, "국내배당": 0,
                })
                continue
            try:
                cnt = con.execute(f'SELECT COUNT(*) FROM "{lg}"').fetchone()[0]
                smin, smax = con.execute(f'SELECT MIN(S), MAX(S) FROM "{lg}"').fetchone()
                try:
                    rt_n = con.execute(
                        f'SELECT COUNT(*) FROM "{lg}" WHERE RT IS NOT NULL').fetchone()[0]
                except sqlite3.Error:
                    rt_n = 0
                try:
                    kw_n = con.execute(
                        f'SELECT COUNT(*) FROM "{lg}" WHERE KW IS NOT NULL').fetchone()[0]
                except sqlite3.Error:
                    kw_n = 0
            except sqlite3.Error:
                cnt, smin, smax, rt_n, kw_n = 0, None, None, 0, 0

            out.append({
                "리그": LEAGUE_LABEL[lg],
                "코드": lg,
                "경기수": cnt,
                "시즌": f"{smin} ~ {smax}" if smin else "-",
                "결과보유": rt_n,
                "예정": cnt - rt_n,          # RT 없는 행 = 예측 대상 경기
                "국내배당": kw_n,
            })
    finally:
        con.close()
    return out


def db_total_rows(db_path: str) -> int:
    """전 리그 합계 경기수."""
    if not os.path.exists(db_path):
        return 0
    tabs = set(list_tables(db_path))
    con = sqlite3.connect(db_path)
    total = 0
    try:
        for lg in LEAGUES:
            if lg in tabs:
                try:
                    total += con.execute(f'SELECT COUNT(*) FROM "{lg}"').fetchone()[0]
                except sqlite3.Error:
                    pass
    finally:
        con.close()
    return total


def db_filesize_mb(db_path: str) -> float:
    try:
        return round(os.path.getsize(db_path) / (1024 * 1024), 2)
    except OSError:
        return 0.0


def user_storage_summary() -> List[dict]:
    """
    💡 [업데이트 내용] 계정관리 탭용 - 전 고객 업로드 현황 (C안: 열람 허용).
    관리자가 장애 대응/용량 관리를 할 수 있게 메타데이터를 집계한다.
    데이터 내용 자체는 별도 [🔍 원본 열람] 에서만 조회하며 access_log 에 기록.
    """
    out = []
    for u in list_usernames():
        p = get_user_db(u)
        rows = db_total_rows(p)
        lgs = [d["리그"] for d in league_dashboard(p) if d["경기수"] > 0]
        try:
            mt = datetime.datetime.fromtimestamp(
                os.path.getmtime(p)).strftime("%Y-%m-%d %H:%M")
        except OSError:
            mt = "-"
        pl = get_predlog_db(u)
        pred_n = 0
        if os.path.exists(pl):
            con = sqlite3.connect(pl)
            try:
                pred_n = con.execute("SELECT COUNT(*) FROM prediction_log").fetchone()[0]
            except sqlite3.Error:
                pred_n = 0
            finally:
                con.close()
        out.append({
            "아이디": u,
            "경기수": rows,
            "리그": ", ".join(lgs) if lgs else "-",
            "예측로그": pred_n,
            "최종수정": mt,
            "크기(MB)": db_filesize_mb(p),
        })
    return out


# =============================================================
# 열람 기록 (C안)
# =============================================================

def log_access(admin_id: str, target_user: str, league: str = "",
               action: str = "view", rows: int = 0) -> None:
    """
    💡 [업데이트 내용] 관리자가 고객 데이터를 열람할 때 기록.
    관리자는 열람만 가능하고 수정/삭제는 불가하지만,
    열람 사실 자체를 남겨 분쟁 시 근거로 쓴다.
    """
    try:
        p = ensure_access_log_db()
        con = sqlite3.connect(p)
        try:
            con.execute(
                "INSERT INTO access_log(ts, admin_id, target_user, league, action, rows) "
                "VALUES(?,?,?,?,?,?)",
                (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                 str(admin_id), str(target_user), str(league), str(action), int(rows)))
            con.commit()
        finally:
            con.close()
    except Exception:
        pass  # 로깅 실패가 기능을 막지 않는다


def list_access_log(limit: int = 200) -> List[dict]:
    p = get_access_log_db()
    if not os.path.exists(p):
        return []
    con = sqlite3.connect(p)
    try:
        rows = con.execute(
            "SELECT ts, admin_id, target_user, league, action, rows "
            "FROM access_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [{"시각": r[0], "관리자": r[1], "대상": r[2],
                 "리그": r[3], "동작": r[4], "건수": r[5]} for r in rows]
    except sqlite3.Error:
        return []
    finally:
        con.close()


# =============================================================
# meta 헬퍼
# =============================================================

def set_meta(db_path: str, key: str, value: str) -> None:
    try:
        con = sqlite3.connect(db_path)
        try:
            con.execute(_SCHEMA_META)
            con.execute(
                "INSERT INTO meta(k, v) VALUES(?, ?) "
                "ON CONFLICT(k) DO UPDATE SET v=excluded.v",
                (key, str(value)))
            con.commit()
        finally:
            con.close()
    except sqlite3.Error:
        pass


def get_meta(db_path: str, key: str, default: Optional[str] = None) -> Optional[str]:
    if not os.path.exists(db_path):
        return default
    con = sqlite3.connect(db_path)
    try:
        row = con.execute("SELECT v FROM meta WHERE k=?", (key,)).fetchone()
        return row[0] if row else default
    except sqlite3.Error:
        return default
    finally:
        con.close()


def stamp_updated(db_path: str) -> str:
    """DB 갱신 시각 기록. UI '최종 갱신' 표시용."""
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    set_meta(db_path, "updated_at", ts)
    set_meta(db_path, "app_version", f"{APP_NAME} {APP_VERSION}")
    return ts


# =============================================================
# 부팅 초기화
# =============================================================

def bootstrap() -> None:
    """앱 시작 시 1회. 디렉터리 + auth.db + master.db 존재 보장."""
    os.makedirs(_DATA_DIR, exist_ok=True)
    os.makedirs(_MASTER_DIR, exist_ok=True)
    os.makedirs(_BACKUP_DIR, exist_ok=True)
    os.makedirs(_USERS_DIR, exist_ok=True)
    ensure_master_db()
    ensure_access_log_db()


if __name__ == "__main__":
    bootstrap()
    mp = get_master_db()
    print(f"{APP_NAME} {APP_VERSION} - 경로 초기화 완료\n")
    print(f"  (1) auth.db    : {get_auth_db()}")
    print(f"  (2) master.db  : {mp} ({db_filesize_mb(mp)} MB / {db_total_rows(mp):,} 경기)")
    print(f"  (3,4) users    : {_USERS_DIR}")
    print(f"  (5) access_log : {get_access_log_db()}")
    print()
    for row in league_dashboard(mp):
        print(f"  {row['리그']:8s} {row['경기수']:6,}건  {row['시즌']:16s} "
              f"결과 {row['결과보유']:,} / 예정 {row['예정']:,} / 국배 {row['국내배당']:,}")
    users = list_usernames()
    if users:
        print(f"\n  고객 계정 {len(users)}개:")
        for r in user_storage_summary():
            print(f"    {r['아이디']:12s} {r['경기수']:6,}건  {r['크기(MB)']}MB  {r['최종수정']}")
