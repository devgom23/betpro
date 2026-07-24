# -*- coding: utf-8 -*-
# ============================================================================================
# WEB_BET PRO V1.0 - 웹 인증 모듈 v1.0  (관리자 계정 관리 + 로그인)
# --------------------------------------------------------------------------------------------
#  - 계정 저장: auth.db 내 users 테이블  (★ v1.0: master.db 와 분리됨)
#  - 비밀번호: PBKDF2-HMAC-SHA256 (salt 개별) -> 평문 저장 안 함
#  - 만료일: expiry 'YYYY-MM-DD' 또는 'permanent'. 만료 시 로그인 차단(연장하면 재개)
#  - 역할: role 'admin' / 'user'
#  - 최초 실행 시 기본 관리자(admin / 초기비번) 자동 생성 -> 로그인 후 즉시 변경 권장
#  ★ 이 파일은 v7.3W 원본 무수정. db_path 를 인자로 받으므로 경로만 바뀐다.
# ============================================================================================
import sqlite3
import hashlib
import os
import secrets
import datetime

DEFAULT_ADMIN_ID = "admin"
DEFAULT_ADMIN_PW = "betpro-admin-2026"   # ★ 최초 로그인 후 반드시 변경


def _conn(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            username   TEXT PRIMARY KEY,
            pw_hash    TEXT NOT NULL,
            salt       TEXT NOT NULL,
            role       TEXT NOT NULL DEFAULT 'user',
            expiry     TEXT NOT NULL DEFAULT 'permanent',
            created_dt TEXT,
            note       TEXT DEFAULT ''
        )
    """)
    conn.commit()
    return conn


def _hash_pw(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"),
                               salt.encode("utf-8"), 200_000).hex()


def ensure_default_admin(db_path):
    """관리자 계정이 하나도 없으면 기본 관리자 생성."""
    conn = _conn(db_path)
    try:
        n = conn.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0]
        if n == 0:
            salt = secrets.token_hex(16)
            conn.execute(
                "INSERT OR REPLACE INTO users VALUES (?,?,?,?,?,?,?)",
                (DEFAULT_ADMIN_ID, _hash_pw(DEFAULT_ADMIN_PW, salt), salt,
                 "admin", "permanent",
                 datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), "기본 관리자"))
            conn.commit()
            return True
        return False
    finally:
        conn.close()


def verify_login(db_path, username, password):
    """로그인 검증. 반환: (ok, info)
    info={code, role, expiry, msg}  code: OK/NO_USER/BAD_PW/EXPIRED"""
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT pw_hash, salt, role, expiry FROM users WHERE username=?",
            (username.strip(),)).fetchone()
    finally:
        conn.close()
    if not row:
        return False, {"code": "NO_USER", "msg": "존재하지 않는 아이디입니다."}
    pw_hash, salt, role, expiry = row
    if _hash_pw(password, salt) != pw_hash:
        return False, {"code": "BAD_PW", "msg": "비밀번호가 일치하지 않습니다."}
    if expiry and expiry.lower() != "permanent":
        try:
            exp = datetime.date.fromisoformat(expiry)
            if datetime.date.today() > exp:
                return False, {"code": "EXPIRED", "role": role, "expiry": expiry,
                               "msg": f"이용 기간이 만료되었습니다. (만료일 {expiry})"}
        except Exception:
            return False, {"code": "BAD_EXPIRY", "msg": "만료일 형식 오류."}
    return True, {"code": "OK", "role": role, "expiry": expiry, "msg": "로그인 성공"}


# --- 관리자 CRUD ---
def list_users(db_path):
    conn = _conn(db_path)
    try:
        rows = conn.execute(
            "SELECT username, role, expiry, created_dt, note FROM users ORDER BY role, username"
        ).fetchall()
        return [{"username": r[0], "role": r[1], "expiry": r[2],
                 "created_dt": r[3], "note": r[4]} for r in rows]
    finally:
        conn.close()


def add_user(db_path, username, password, expiry="permanent", role="user", note=""):
    """계정 추가. 반환 (ok, msg)."""
    username = username.strip()
    if not username or not password:
        return False, "아이디와 비밀번호를 입력하세요."
    if len(password) < 4:
        return False, "비밀번호는 4자 이상이어야 합니다."
    if expiry.lower() != "permanent":
        try:
            datetime.date.fromisoformat(expiry)
        except Exception:
            return False, "만료일 형식 오류 (예: 2026-12-31 또는 permanent)."
    conn = _conn(db_path)
    try:
        exists = conn.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone()
        if exists:
            return False, f"이미 존재하는 아이디입니다: {username}"
        salt = secrets.token_hex(16)
        conn.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?)",
                     (username, _hash_pw(password, salt), salt, role, expiry,
                      datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), note))
        conn.commit()
        return True, f"계정 생성 완료: {username}"
    finally:
        conn.close()


def delete_user(db_path, username):
    """계정 삭제. 마지막 관리자 삭제는 거부."""
    conn = _conn(db_path)
    try:
        row = conn.execute("SELECT role FROM users WHERE username=?", (username,)).fetchone()
        if not row:
            return False, "존재하지 않는 계정입니다."
        if row[0] == "admin":
            admin_n = conn.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0]
            if admin_n <= 1:
                return False, "마지막 관리자 계정은 삭제할 수 없습니다."
        conn.execute("DELETE FROM users WHERE username=?", (username,))
        conn.commit()
        return True, f"삭제 완료: {username}"
    finally:
        conn.close()


def update_expiry(db_path, username, expiry):
    """이용 기간 연장/변경."""
    if expiry.lower() != "permanent":
        try:
            datetime.date.fromisoformat(expiry)
        except Exception:
            return False, "만료일 형식 오류 (예: 2026-12-31 또는 permanent)."
    conn = _conn(db_path)
    try:
        r = conn.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone()
        if not r:
            return False, "존재하지 않는 계정입니다."
        conn.execute("UPDATE users SET expiry=? WHERE username=?", (expiry, username))
        conn.commit()
        return True, f"기간 변경 완료: {username} -> {expiry}"
    finally:
        conn.close()


def change_password(db_path, username, new_password):
    """비밀번호 변경."""
    if len(new_password) < 4:
        return False, "비밀번호는 4자 이상이어야 합니다."
    conn = _conn(db_path)
    try:
        r = conn.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone()
        if not r:
            return False, "존재하지 않는 계정입니다."
        salt = secrets.token_hex(16)
        conn.execute("UPDATE users SET pw_hash=?, salt=? WHERE username=?",
                     (_hash_pw(new_password, salt), salt, username))
        conn.commit()
        return True, "비밀번호 변경 완료."
    finally:
        conn.close()


def days_left(expiry):
    """만료까지 남은 일수. permanent면 None."""
    if not expiry or expiry.lower() == "permanent":
        return None
    try:
        return (datetime.date.fromisoformat(expiry) - datetime.date.today()).days
    except Exception:
        return None


# ============================================================================================
# 💡 [업데이트 내용] V1.0: 자동 로그인 토큰 (로그인 유지)
# --------------------------------------------------------------------------------------------
#  · 비밀번호는 쿠키에 저장하지 않는다. HMAC 서명된 토큰만 저장.
#  · 토큰 만료 = 계정 만료일 (permanent 계정이면 무기한)
#  · 서명에 salt 앞 8자를 섞음 -> 비밀번호를 바꾸면 salt가 새로 생성되므로
#    기존 토큰이 자동 무효화된다 (도난 토큰 차단 수단)
#  · SECRET_KEY 는 auth.db 의 app_meta 테이블에 보관 -> 서버 재시작해도 토큰 유지
#  ★ 중요: 토큰은 "누구인지"만 증명한다. 권한(role)과 만료 판정은 매번 DB를 다시 조회한다.
#     토큰만 믿으면 계정을 삭제해도 쿠키로 계속 들어올 수 있다.
# ============================================================================================
import hmac
import base64

TOKEN_VERSION = "v1"


def _meta_conn(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS app_meta (
            k TEXT PRIMARY KEY,
            v TEXT
        )
    """)
    conn.commit()
    return conn


def get_secret_key(db_path):
    """서명용 비밀키. 없으면 최초 1회 생성 후 보관."""
    conn = _meta_conn(db_path)
    try:
        row = conn.execute("SELECT v FROM app_meta WHERE k='secret_key'").fetchone()
        if row and row[0]:
            return row[0]
        key = secrets.token_hex(32)
        conn.execute("INSERT OR REPLACE INTO app_meta VALUES ('secret_key', ?)", (key,))
        conn.commit()
        return key
    finally:
        conn.close()


def _sign(payload, secret):
    return hmac.new(secret.encode("utf-8"),
                    payload.encode("utf-8"),
                    hashlib.sha256).hexdigest()


def _get_salt_head(db_path, username):
    """해당 계정 salt 앞 8자. 비번 변경 시 값이 바뀌어 기존 토큰이 무효화됨."""
    conn = _conn(db_path)
    try:
        row = conn.execute("SELECT salt FROM users WHERE username=?",
                           (username,)).fetchone()
        return row[0][:8] if row and row[0] else ""
    finally:
        conn.close()


def issue_token(db_path, username):
    """로그인 성공 후 자동로그인 토큰 발급. 실패 시 None."""
    try:
        username = username.strip()
        salt_head = _get_salt_head(db_path, username)
        if not salt_head:
            return None
        secret = get_secret_key(db_path)
        issued = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        payload = f"{TOKEN_VERSION}|{username}|{salt_head}|{issued}"
        sig = _sign(payload, secret)
        raw = f"{payload}|{sig}"
        return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")
    except Exception:
        return None


def verify_token(db_path, token):
    """
    토큰 검증 -> (ok, info). info={username, role, expiry, msg, code}
    ★ 서명 통과 후에도 DB를 다시 조회해 계정 존재/만료/역할을 확인한다.
      - 계정 삭제됨      -> 차단
      - 이용기간 만료됨   -> 차단 (연장하면 즉시 재개)
      - 비밀번호 변경됨   -> salt 변경 -> 서명 불일치 -> 차단
    """
    if not token:
        return False, {"code": "NO_TOKEN", "msg": ""}
    try:
        raw = base64.urlsafe_b64decode(token.encode("ascii")).decode("utf-8")
        parts = raw.split("|")
        if len(parts) != 5:
            return False, {"code": "BAD_FORMAT", "msg": "토큰 형식 오류"}
        ver, username, salt_head, issued, sig = parts
        if ver != TOKEN_VERSION:
            return False, {"code": "BAD_VERSION", "msg": "토큰 버전 불일치"}

        secret = get_secret_key(db_path)
        payload = f"{ver}|{username}|{salt_head}|{issued}"
        # 타이밍 공격 방지용 상수시간 비교
        if not hmac.compare_digest(_sign(payload, secret), sig):
            return False, {"code": "BAD_SIG", "msg": "토큰 서명 불일치"}

        # ── 서명은 통과. 이제 DB가 최종 판정 ──
        conn = _conn(db_path)
        try:
            row = conn.execute(
                "SELECT salt, role, expiry FROM users WHERE username=?",
                (username,)).fetchone()
        finally:
            conn.close()

        if not row:
            return False, {"code": "NO_USER", "msg": "계정이 존재하지 않습니다."}
        salt, role, expiry = row

        # 비밀번호가 바뀌었으면 salt 가 달라져 토큰 무효
        if salt[:8] != salt_head:
            return False, {"code": "STALE", "msg": "비밀번호가 변경되어 재로그인이 필요합니다."}

        # 계정 만료 = 토큰 만료
        if expiry and expiry.lower() != "permanent":
            try:
                if datetime.date.today() > datetime.date.fromisoformat(expiry):
                    return False, {"code": "EXPIRED", "expiry": expiry,
                                   "msg": f"이용 기간이 만료되었습니다. (만료일 {expiry})"}
            except Exception:
                return False, {"code": "BAD_EXPIRY", "msg": "만료일 형식 오류."}

        return True, {"code": "OK", "username": username, "role": role,
                      "expiry": expiry, "msg": "자동 로그인"}
    except Exception:
        return False, {"code": "ERROR", "msg": "토큰 검증 실패"}
