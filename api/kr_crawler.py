"""
젠토토(zentoto.com) 국내배당(초기배당) 가져오기.

[동작 방식]
  화면에서 "화면 열기"를 누르면 크롬 창이 그 연도/회차의 프로토 목록 페이지로 열린다.
  (Zentoto는 로그인이 필요하다 — 영속 크롬 프로필을 써서 한 번 로그인해 두면 다음부터
   다시 로그인하지 않아도 된다. 사용자가 이미 쓰던 데스크톱 크롤러와 같은 프로필 폴더를
   그대로 재사용한다.)
  "가져오기"를 누르면 그 순간 화면에 떠 있는 경기들의 국내배당(초기배당 기준)을 읽어
  BETPRO 국내배당 칸(KW/KD/KL/KH/KHW/KHD/KHL) 형식으로 돌려준다.

[초기배당인 이유]
  배당은 경기 전까지 계속 바뀐다. 분석은 '최초 발표 배당' 기준이 원칙이라, 화면에 배당
  변경 이력이 있는 경기는 /proto/history에서 '초기배당' 행을 다시 조회해 그 값을 쓴다.
  변경이 없었던 경기는 화면에 보이는 값 그대로가 이미 초기배당이라 그대로 쓴다.

[채우지 않는 값]
  RT(경기결과)·HS/AS(스코어)·해외배당은 이 사이트에 없으므로 비워서 내려보낸다.
  이미 있는 경기에 병합될 때 빈 칸은 기존 값을 지우지 않는다(main.py의
  _keep_existing_where_blank 규칙).
"""
import os
import re
import threading
import time
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

BASE = "https://www.zentoto.com"


class CrawlError(RuntimeError):
    """크롤링 중 사용자에게 그대로 보여줄 오류."""


def _get_output_dir() -> str:
    """사용자가 기존 데스크톱 크롤러에서 쓰던 것과 같은 폴더 — 로그인 세션을 그대로 재사용한다."""
    home = os.path.expanduser("~")
    desktops = [
        os.path.join(home, "Desktop"),
        os.path.join(home, "OneDrive", "Desktop"),
        os.path.join(home, "OneDrive", "바탕 화면"),
        os.path.join(home, "바탕 화면"),
    ]
    for d in desktops:
        z = os.path.join(d, "zentoto")
        if os.path.isdir(z):
            return z
    for d in desktops:
        if os.path.isdir(d):
            z = os.path.join(d, "zentoto")
            os.makedirs(z, exist_ok=True)
            return z
    z = os.path.join(home, "zentoto")
    os.makedirs(z, exist_ok=True)
    return z


OUTPUT_DIR = _get_output_dir()
PROFILE_DIR = os.path.join(OUTPUT_DIR, "zentoto_chrome_profile")

_driver = None
_lock = threading.Lock()   # 크롬 창은 하나뿐이라 요청이 겹치지 않게 직렬화


# ─────────────────────────── 브라우저 제어 ───────────────────────────
def _alive(drv) -> bool:
    try:
        _ = drv.current_url
        return True
    except Exception:
        return False


def build_round_url(year, rnd) -> str:
    """
    사용자가 쓰던 데스크톱 크롤러와 같은 쿼리 구조를 그대로 쓴다 — order_by_data/
    order_by_type/bet_type[] 파라미터가 빠지면 사이트가 요청한 회차를 무시하고
    최신 회차로 리다이렉트하며 회차 선택 UI도 정상적으로 뜨지 않는 것을 확인했다.
    game_name[] 필터(원본은 유럽 6대리그 전용)는 여기서 K리그를 걸러야 하므로 빼고,
    대신 _parse_lines()가 파싱 단계에서 target_league로 직접 걸러낸다.
    """
    params = [
        ("order_by_data", "proto_uid"), ("order_by_type", "asc"),
        ("proto_year", str(year)), ("proto_round", str(rnd)),
        ("bet_type[]", "N"), ("bet_type[]", "H"),
    ]
    qs = "&".join(f"{k}={quote(str(v))}" for k, v in params)
    return f"{BASE}/proto/{rnd}?{qs}"


def open_round(year, rnd) -> str:
    """크롬 창을 그 연도/회차의 프로토 화면으로 연다. 이미 열려 있으면 재사용."""
    global _driver
    year = str(year).strip()
    rnd = str(rnd).strip()
    if not year or not rnd:
        raise CrawlError("연도와 회차를 입력해 주세요.")
    url = build_round_url(year, rnd)
    with _lock:
        if _driver is not None and not _alive(_driver):
            _driver = None                      # 사용자가 창을 닫은 경우
        if _driver is None:
            try:
                from selenium import webdriver
                from selenium.webdriver.chrome.service import Service
                from webdriver_manager.chrome import ChromeDriverManager
            except ImportError as e:
                raise CrawlError(f"크롤링 모듈이 설치되어 있지 않습니다: {e}")
            try:
                opts = webdriver.ChromeOptions()
                opts.add_argument(f"--user-data-dir={PROFILE_DIR}")
                opts.add_argument("--disable-blink-features=AutomationControlled")
                opts.add_experimental_option("excludeSwitches", ["enable-automation"])
                opts.add_experimental_option("useAutomationExtension", False)
                _driver = webdriver.Chrome(
                    service=Service(ChromeDriverManager().install()), options=opts)
            except Exception as e:
                raise CrawlError(f"크롬을 열지 못했습니다: {e}")
        try:
            _driver.get(url)
        except Exception as e:
            raise CrawlError(f"페이지 이동 실패: {e}")
    return url


def close_page():
    """크롬 창을 닫는다. 안 열려 있어도 조용히 넘어간다."""
    global _driver
    with _lock:
        if _driver is not None:
            try:
                _driver.quit()
            except Exception:
                pass
            _driver = None
    return True


def is_open() -> bool:
    return _driver is not None and _alive(_driver)


# ─────────────────────────── 세션/조회 ───────────────────────────
def _make_session(driver):
    s = requests.Session()
    try:
        ua = driver.execute_script("return navigator.userAgent;")
    except Exception:
        ua = "Mozilla/5.0"
    s.headers.update({
        "User-Agent": ua,
        "X-Requested-With": "XMLHttpRequest",
        "Referer": driver.current_url,
        "Accept": "text/html, */*; q=0.01",
    })
    for c in driver.get_cookies():
        try:
            s.cookies.set(c["name"], c["value"], domain=c.get("domain"))
        except Exception:
            pass
    return s


def _fetch_initial_odds(session, round_id, proto_uid, game_idx):
    """변경내역의 '초기배당' 행 → (승, 무, 패) 또는 None."""
    url = (f"{BASE}/proto/history"
           f"?proto_round={round_id}&proto_uid={proto_uid}&game_idx={game_idx}")
    for _ in range(2):
        try:
            r = session.get(url, timeout=10)
            if r.status_code != 200 or not r.text:
                time.sleep(0.4)
                continue
            txt = BeautifulSoup(r.text, "html.parser").get_text(" ", strip=True)
            idx = txt.find("초기배당")
            if idx == -1:
                return None
            nums = re.findall(r"\d+\.\d{2}", txt[idx + len("초기배당"):])
            if len(nums) >= 3:
                return nums[0], nums[1], nums[2]
            return None
        except Exception:
            time.sleep(0.4)
    return None


def _to_int(x):
    try:
        return int(re.sub(r"[^0-9]", "", str(x)) or 0)
    except Exception:
        return 0


def _fmt_handi(handisign):
    """'H+1.0' → 1.0 , 'H-1.0' → -1.0"""
    if not handisign:
        return None
    m = re.search(r"([+-]?\d+(?:\.\d+)?)", handisign)
    if not m:
        return None
    try:
        v = float(m.group(1))
    except Exception:
        return None
    return 1.0 if v > 0 else -1.0 if v < 0 else None


def _parse_lines(soup, target_league: str):
    lines = []
    for d in soup.select(".dist-table"):
        bet = (d.get("bet-type") or "").upper()
        pid = d.get("proto-pid") or d.get("proto-uid")
        uid = d.get("proto-uid") or ""
        home = (d.get("tn-home") or "").strip()
        away = (d.get("tn-away") or "").strip()
        change_no = (d.get("change-no") or "0").strip()
        changed = change_no not in ("", "0")
        handisign = d.get("handisign") or ""

        tr = d.find_parent("tr")
        league, game_idx = "", ""
        if tr:
            gn = tr.select_one(".game-name")
            if gn:
                league = (gn.get("title") or gn.get_text(strip=True)).strip()
            noti = tr.select_one(".game-noti")
            if noti and noti.get("game-idx"):
                game_idx = noti.get("game-idx")
        if not game_idx:
            game_idx = d.get("game-idx") or ""

        cur = {"W": "", "D": "", "L": ""}
        for c in d.select(".slt-odds"):
            w = c.get("wdl")
            if w in cur:
                cur[w] = (c.get("odds") or "").strip()

        if target_league and league and league != target_league:
            continue
        if not pid or not home or not away:
            continue

        lines.append({
            "pid": pid, "uid": uid, "idx": game_idx, "bet": bet,
            "league": league, "home": home, "away": away,
            "changed": changed, "handi": handisign,
            "W": cur["W"], "D": cur["D"], "L": cur["L"],
        })
    return lines


def fetch_domestic(target_league: str, wait: float = 0.0) -> dict:
    """
    지금 화면에 떠 있는 경기들의 국내배당(초기배당 기준)을 가져온다.
    target_league(예: 'K리그1')와 다른 리그명은 건너뛴다.
    """
    if not is_open():
        raise CrawlError("먼저 '화면 열기'로 화면을 열어 주세요.")

    with _lock:
        html = _driver.page_source
        cur_url = _driver.current_url
        session = _make_session(_driver)

    if "dist-table" not in html and "로그인" in BeautifulSoup(html, "html.parser").get_text()[:3000]:
        raise CrawlError("로그인 안 된 화면 같습니다. 크롬 창에서 로그인 후 다시 시도하세요.")

    soup = BeautifulSoup(html, "html.parser")
    lines = _parse_lines(soup, target_league)
    if not lines:
        raise CrawlError(f"'{target_league or '(전체)'}' 경기를 화면에서 찾지 못했습니다. "
                         "회차·리그명을 확인해 주세요.")

    round_id = ""
    m = re.search(r"proto_round=(\d+)", cur_url)
    if m:
        round_id = m.group(1)

    matches = {}
    for ln in lines:
        rec = matches.setdefault(ln["pid"], {"N": None, "H": None})
        if ln["bet"] == "N" and rec["N"] is None:
            rec["N"] = ln
        elif ln["bet"] == "H":
            if rec["H"] is None or _to_int(ln["uid"]) < _to_int(rec["H"]["uid"]):
                rec["H"] = ln

    def resolve_initial(ln):
        if ln is None:
            return ("", "", "", "")
        if not ln["changed"]:
            return (ln["W"], ln["D"], ln["L"], "")
        got = _fetch_initial_odds(session, round_id, ln["uid"], ln["idx"])
        time.sleep(0.25)
        if got:
            return (got[0], got[1], got[2], "")
        return (ln["W"], ln["D"], ln["L"], "초기배당조회실패(현재배당)")

    rows = []
    fail_cnt = 0
    for pid, rec in matches.items():
        meta = rec["N"] or rec["H"]
        w, d, l, note1 = resolve_initial(rec["N"])
        hw, hd, hl, note2 = resolve_initial(rec["H"])
        note = " / ".join(x for x in (note1, note2) if x)
        if note:
            fail_cnt += 1
        kh = _fmt_handi(rec["H"]["handi"]) if rec["H"] else None
        rows.append({
            "HT": meta["home"], "AT": meta["away"],
            "KW": w or None, "KD": d or None, "KL": l or None,
            "KH": kh,
            "KHW": hw or None, "KHD": hd or None, "KHL": hl or None,
            "_note": note,
        })

    return {"round_id": round_id, "count": len(rows), "fail_cnt": fail_cnt, "rows": rows}
