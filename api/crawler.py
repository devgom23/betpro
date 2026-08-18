"""
스코어맨(football.scoreman123.com) 경기·배당 가져오기.

[동작 방식]
  화면에서 "Data 가져오기"를 누르면 크롬 창이 그 리그 페이지에 열린다.
  사용자가 그 창에서 원하는 시즌·라운드를 직접 고른 뒤 "가져오기"를 누르면,
  그 순간 화면에 떠 있는 경기들을 읽어 BETPRO 업로드 형식으로 돌려준다.
  (시즌 자동 순회는 하지 않는다 — 화면에 보이는 것만 가져오는 게 원칙)

[배당을 두 번 읽는 이유]
  리그 페이지의 배당 3칸(span.odds)은 드롭다운 선택에 따라 의미가 바뀐다.
    승무패(type=O) → 승 / 무 / 패          = FW / FD / FL
    핸디캡(type=L) → 홈 / 핸디기준 / 원정  = FHW / (기준) / FHL
  그래서 드롭다운을 전환해가며 두 번 읽고 matchid로 병합한다.

[채우지 않는 값]
  RT(경기결과 구분)와 FH(핸디)는 비워서 내려보낸다.
  FH는 국내배당 기준으로 정해지는데 이 사이트엔 국내배당이 없고,
  RT는 사용자가 직접 넣는 값이기 때문(추후 표에서 직접 수정 예정).
"""
import os
import re
import sqlite3
import threading
import time

from bs4 import BeautifulSoup

LEAGUE_URL = "https://football.scoreman123.com/league/{id}"

# 공식 6대리그의 스코어맨 리그 ID(기본값). 사용자가 바꾸면 계정 DB의 설정이 우선한다.
DEFAULT_LEAGUE_IDS = {
    "EPL": 36, "LALIGA": 31, "SERIEA": 34,
    "BUNDES": 8, "EREDIVISIE": 16, "LIGUE1": 11,
}
# 참고용 — 내 데이터에서 K리그를 만들 때 쓰라고 화면에 보여줄 후보
KNOWN_LEAGUE_IDS = dict(DEFAULT_LEAGUE_IDS, **{"K리그1": 15, "K리그2": 1292})

MODE_WDL = "O"        # 승무패
MODE_HANDICAP = "L"   # 핸디캡

_driver = None
_lock = threading.Lock()   # 크롬 창은 하나뿐이라 요청이 겹치지 않게 직렬화


class CrawlError(RuntimeError):
    """크롤링 중 사용자에게 그대로 보여줄 오류."""


# ─────────────────────────── 브라우저 제어 ───────────────────────────
def _alive(drv) -> bool:
    try:
        _ = drv.current_url
        return True
    except Exception:
        return False


def open_page(url: str) -> str:
    """크롬 창을 띄우고 그 주소로 이동한다. 이미 열려 있으면 재사용."""
    global _driver
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
                opts.add_experimental_option("excludeSwitches", ["enable-automation"])
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


def select_round(n) -> str:
    """열려 있는 화면에서 라운드를 바꾼다. 성공하면 바뀐 라운드('17R')를 돌려준다."""
    if not is_open():
        raise CrawlError("먼저 'Data 가져오기'로 화면을 열어 주세요.")
    try:
        num = int(str(n).strip().upper().replace("R", ""))
    except (TypeError, ValueError):
        raise CrawlError("라운드는 숫자로 입력해 주세요.")
    with _lock:
        ok = _driver.execute_script(
            "var e=document.querySelector('div.round span[round=\"%d\"]');"
            "if(!e){return false;} e.click(); return true;" % num)
        if not ok:
            raise CrawlError(f"{num}라운드를 찾지 못했습니다. 그 시즌에 있는 라운드인지 확인해 주세요.")
        time.sleep(1.5)          # 목록이 다시 그려질 때까지 대기
        got = _round_of(BeautifulSoup(_driver.page_source, "html.parser"))
    return got or f"{num}R"


def _switch_odds(kind: str) -> bool:
    """
    배당 드롭다운을 승무패(O)/핸디캡(L)으로 전환한다.
    실제 DOM 확인 결과 구조가 이렇게 고정되어 있어 type 속성으로 정확히 집을 수 있다:
        <div class="odds selectbox"><ul class="selectpop">
            <li type="O">승무패</li><li type="T">언오버</li><li type="L">핸디캡</li>
    """
    js = (
        "var el = document.querySelector('.odds.selectbox .selectpop li[type=\"%s\"]');"
        "if (!el) { return false; } el.click(); return true;" % kind
    )
    try:
        return bool(_driver.execute_script("return (function(){%s})();" % js))
    except Exception:
        return False


# ─────────────────────────── 파싱 ───────────────────────────
def _clean_team(text: str) -> str:
    """팀명에 붙은 [순위] 같은 꼬리표 제거."""
    t = re.sub(r"[\[［]\s*\d+\s*[\]］]", "", text or "")
    return " ".join(t.split())


def _season_of(soup) -> str:
    """
    현재 화면의 시즌을 BETPRO 표기로.
      '2025-2026' → '25-26' (유럽)      '2026' → '2026' (K리그처럼 단일 연도)
    시즌 목록에서 선택된 항목을 먼저 보고, 없으면 페이지 제목에서 뽑는다.
    """
    for li in soup.find_all("li"):
        oc = li.get("onclick") or ""
        cls = " ".join(li.get("class") or [])
        if "changeSeason" in oc and "on" in cls.split():
            txt = li.get_text(strip=True)
            if txt:
                return _fmt_season(txt)
    title = soup.title.get_text() if soup.title else ""
    m = re.search(r"(\d{4}-\d{4}|\d{4})\s*시즌", title)
    return _fmt_season(m.group(1)) if m else ""


def _fmt_season(text: str) -> str:
    text = (text or "").strip()
    m = re.match(r"^(\d{4})-(\d{4})$", text)
    if m:
        return f"{m.group(1)[2:]}-{m.group(2)[2:]}"
    m = re.match(r"^(\d{4})$", text)
    return m.group(1) if m else text


def _date_time(row):
    """
    날짜/시각을 (YYYY-MM-DD, HHMM) 로.

    화면 텍스트('08.22 04:00')엔 연도가 없고, data-t('2026-08-22 03:00')엔 연도가 있지만
    시각이 화면과 1시간 어긋난다(사이트 기준 시간대가 달라서). 그래서 연·월·일은 data-t를
    기준으로 삼고, 표시 시각은 화면 텍스트를 그대로 쓴다 — 사용자가 보는 값과 일치시키기 위함.
    자정을 넘겨 표시일이 data-t보다 하루 뒤인 경우도 표시 월/일을 우선한다.
    """
    el = row.find("span", class_="date")
    if not el:
        return "", ""
    data_t = (el.get("data-t") or "").strip()
    shown = el.get_text(strip=True)

    year = ""
    base_md = ""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", data_t)
    if m:
        year, base_md = m.group(1), f"{m.group(2)}-{m.group(3)}"

    md, hhmm = "", ""
    m = re.match(r"^(\d{2})[.\-/](\d{2})\s+(\d{1,2}):(\d{2})", shown)
    if m:
        md = f"{m.group(1)}-{m.group(2)}"
        hhmm = f"{int(m.group(3)):02d}{m.group(4)}"

    if not md:
        md = base_md
    if not year:
        return "", hhmm
    # 12월 31일 → 1월 1일처럼 해를 넘기는 경우 연도를 보정
    if base_md.startswith("12-") and md.startswith("01-"):
        year = str(int(year) + 1)
    elif base_md.startswith("01-") and md.startswith("12-"):
        year = str(int(year) - 1)
    return f"{year}-{md}", hhmm


def _odds3(row):
    box = row.find("span", class_="odds")
    if not box:
        return "", "", ""
    vals = [s.get_text(strip=True) for s in box.find_all("span")]
    vals += ["", "", ""]
    return vals[0], vals[1], vals[2]


def _score(row):
    """홈/원정 득점. 아직 안 치른 경기('-')는 빈 값."""
    raw = (row.get("score") or "").strip()
    if not re.search(r"\d", raw):
        el = row.find("span", class_="score")
        raw = el.get_text(strip=True) if el else ""
    m = re.match(r"^\s*(\d+)\s*[-:]\s*(\d+)\s*$", raw.replace(" ", " "))
    return (m.group(1), m.group(2)) if m else ("", "")


def _round_of(soup) -> str:
    """
    화면에 지금 떠 있는 라운드. 라운드 막대(div.round)의 <span round="N">에서 읽는다.

    ⚠ class가 두 종류인데 서로 따로 논다 — 스코어맨 라리가 화면에서 5R·12R·3R·38R로
      직접 옮겨가며 실측한 결과:
         class="current" : 사이트가 보는 '지금 진행 중인 라운드'. 페이지를 처음 열 때
                           값이 박히고, 사용자가 라운드를 옮겨도 절대 안 움직인다.
         class="on"      : 사용자가 방금 고른 라운드. 이게 실제로 화면에 뜬 목록이다.
      페이지를 처음 열면 1라운드에 class="current on"이 같이 붙어 있어서, 둘을 구분하지
      않고 '먼저 찾은 것'을 쓰면 처음엔 맞는 것처럼 보인다. 그런데 라운드를 옮기는 순간
      'current'가 남아 있는 1R을 먼저 만나기 때문에 어느 라운드를 가져와도 전부 '1R'로
      저장되어 버렸다. 그래서 'on'을 먼저 찾고, 없을 때만 'current'로 물러선다.

    ⚠ div.schedulis 의 page 속성은 라운드가 아니라 목록 페이지 번호다(항상 1).
       그걸 라운드로 쓰면 마찬가지로 전부 '1R'이 되므로 쓰면 안 된다.
    """
    strip = soup.find("div", class_="round")
    if not strip:
        return ""
    for want in ("on", "current"):
        for sp in strip.find_all("span"):
            if want in (sp.get("class") or []):
                n = (sp.get("round") or sp.get_text(strip=True) or "").strip()
                if n.isdigit():
                    return f"{n}R"
    return ""


def _parse(html):
    """현재 화면의 경기들을 {matchid: {...}} 로. 배당은 모드에 따라 뜻이 달라 o1~o3 원본 유지."""
    soup = BeautifulSoup(html, "html.parser")
    season = _season_of(soup)
    rnd = _round_of(soup)
    out = {}
    for row in soup.find_all("div", class_="schedulis"):
        mid = (row.get("matchid") or "").strip()
        home = row.find("span", class_="home")
        away = row.find("span", class_="away")
        if not mid or not home or not away:
            continue
        dt, tm = _date_time(row)
        hs, as_ = _score(row)
        o1, o2, o3 = _odds3(row)
        out[mid] = {
            "matchid": mid,
            "S": season,
            "R": rnd,
            "DT": dt,
            "TM": tm,
            "HT": _clean_team(home.get_text(strip=True)),
            "AT": _clean_team(away.get_text(strip=True)),
            "HS": hs,
            "AS": as_,
            "_o1": o1, "_o2": o2, "_o3": o3,
        }
    return out, season


# ─────────────────────────── 수집 ───────────────────────────
def crawl_current(league_code: str, wait: float = 2.0) -> dict:
    """
    지금 화면에 떠 있는 경기들을 가져온다.
    승무패 → 핸디캡 순으로 드롭다운을 전환해 두 번 읽고 matchid로 병합한다.
    """
    if not is_open():
        raise CrawlError("먼저 'Data 가져오기'로 화면을 열고 시즌·라운드를 선택해 주세요.")

    with _lock:
        # ① 승무패
        if not _switch_odds(MODE_WDL):
            raise CrawlError("배당 선택(승무패)을 찾지 못했습니다. 리그 페이지가 맞는지 확인해 주세요.")
        time.sleep(wait)
        wdl, season = _parse(_driver.page_source)

        # ② 핸디캡
        hcp = {}
        if _switch_odds(MODE_HANDICAP):
            time.sleep(wait)
            hcp, _ = _parse(_driver.page_source)

        # 원래 보던 화면으로 되돌려 둔다
        _switch_odds(MODE_WDL)

    if not wdl:
        raise CrawlError("화면에서 경기를 찾지 못했습니다. 리그 일정 화면인지 확인해 주세요.")

    rows = []
    for i, (mid, m) in enumerate(sorted(wdl.items(), key=lambda kv: (kv[1]["DT"], kv[1]["TM"])), 1):
        h = hcp.get(mid, {})
        rows.append({
            "L": league_code,
            "S": m["S"], "R": m["R"], "No": i,
            "DT": m["DT"], "TM": m["TM"],
            "HT": m["HT"], "HS": m["HS"], "RT": "",     # RT는 사용자가 직접 입력
            "AS": m["AS"], "AT": m["AT"],
            "KW": "", "KD": "", "KL": "", "KH": "",     # 국내배당은 이 사이트에 없음
            "KHW": "", "KHD": "", "KHL": "",
            "FW": m["_o1"], "FD": m["_o2"], "FL": m["_o3"],
            "FH": "",                                    # 국내배당 기준이라 여기선 못 정함
            "FHW": h.get("_o1", ""), "FHD": "", "FHL": h.get("_o3", ""),
            "_핸디기준": h.get("_o2", ""),               # 참고용(업로드 대상 아님)
        })

    rounds = sorted({r["R"] for r in rows if r["R"]})
    return {
        "season": season,
        "rounds": rounds,
        "count": len(rows),
        "matched_handicap": sum(1 for r in rows if r["FHW"]),
        "rows": rows,
    }


# ══════════════════════════ 설정 저장 ══════════════════════════
# 크롤 주소와 팀명 매핑은 '로그인 계정의 DB'에만 저장한다.
# 공식 데이터(master.db)는 분석 원본이라 설정 테이블을 만들지 않는다 —
# master 리그 설정도 계정 DB에 "master:EPL" 같은 키로 넣어 두면 되기 때문.
SOURCE_TABLE = "_crawl_sources"
ALIAS_TABLE = "_team_aliases"
LEAGUE_NAME_TABLE = "_kr_league_names"


def _ensure_tables(con):
    con.execute(f'CREATE TABLE IF NOT EXISTS "{SOURCE_TABLE}" ('
                " key TEXT PRIMARY KEY, url TEXT NOT NULL)")
    con.execute(f'CREATE TABLE IF NOT EXISTS "{ALIAS_TABLE}" ('
                " key TEXT NOT NULL, raw TEXT NOT NULL, mapped TEXT NOT NULL,"
                " PRIMARY KEY (key, raw))")
    con.execute(f'CREATE TABLE IF NOT EXISTS "{LEAGUE_NAME_TABLE}" ('
                " key TEXT PRIMARY KEY, name TEXT NOT NULL)")


def _key(scope: str, code: str, source: str = "") -> str:
    return f"{scope}:{code}:{source}" if source else f"{scope}:{code}"


def default_source(code: str) -> str:
    """공식 6대리그는 스코어맨 리그 ID를 미리 알고 있으므로 기본 주소를 만들어 준다."""
    lid = DEFAULT_LEAGUE_IDS.get(code)
    return LEAGUE_URL.format(id=lid) if lid else ""


def get_source(db_path: str, scope: str, code: str) -> str:
    """저장해 둔 크롤 주소. 없으면 기본값(공식 리그) 또는 빈 문자열."""
    if db_path and os.path.exists(db_path):
        con = sqlite3.connect(db_path)
        try:
            _ensure_tables(con)
            hit = con.execute(f'SELECT url FROM "{SOURCE_TABLE}" WHERE key = ?',
                              (_key(scope, code),)).fetchone()
            if hit and hit[0]:
                return hit[0]
        finally:
            con.close()
    return default_source(code)


def set_source(db_path: str, scope: str, code: str, url: str) -> str:
    """리그별 크롤 주소를 한 번 등록해 두면 다음부터 그대로 열린다."""
    url = (url or "").strip()
    if not re.match(r"^https?://[^\s]+$", url):
        raise CrawlError("주소는 http:// 또는 https:// 로 시작해야 합니다.")
    con = sqlite3.connect(db_path)
    try:
        _ensure_tables(con)
        con.execute(
            f'INSERT INTO "{SOURCE_TABLE}" (key, url) VALUES (?, ?) '
            "ON CONFLICT(key) DO UPDATE SET url = excluded.url",
            (_key(scope, code), url))
        con.commit()
    finally:
        con.close()
    return url


def get_league_name(db_path: str, scope: str, code: str) -> str:
    """국내배당(젠토토) 가져오기 화면에서 사용자가 직접 입력해 저장해 둔 리그명.
    젠토토가 시즌마다 표기를 바꿔서(예: 'K리그2' → 'K리그2 2026') 자동 추정값이 자주
    어긋난다 — 없으면 빈 문자열을 돌려줘 자동 추정값으로 대체하게 한다."""
    if db_path and os.path.exists(db_path):
        con = sqlite3.connect(db_path)
        try:
            _ensure_tables(con)
            hit = con.execute(f'SELECT name FROM "{LEAGUE_NAME_TABLE}" WHERE key = ?',
                              (_key(scope, code),)).fetchone()
            if hit and hit[0]:
                return hit[0]
        finally:
            con.close()
    return ""


def set_league_name(db_path: str, scope: str, code: str, name: str) -> None:
    """직접 입력한 리그명을 저장한다 — 다음에 이 리그의 팝업을 열어도(젠토토가 또
    표기를 바꿔도) 사용자가 다시 고쳐 입력하기 전까지 이 값을 그대로 쓴다."""
    name = (name or "").strip()
    if not name:
        return
    con = sqlite3.connect(db_path)
    try:
        _ensure_tables(con)
        con.execute(
            f'INSERT INTO "{LEAGUE_NAME_TABLE}" (key, name) VALUES (?, ?) '
            "ON CONFLICT(key) DO UPDATE SET name = excluded.name",
            (_key(scope, code), name))
        con.commit()
    finally:
        con.close()


def list_aliases(db_path: str, scope: str, code: str, source: str = "") -> dict:
    """{크롤링팀명: 등록팀명}. 한 번 치환해 두면 다음 크롤링부터 자동 적용된다.
    source를 다르게 주면(예: "kr") 같은 리그라도 다른 치환 규칙을 따로 저장한다."""
    if not db_path or not os.path.exists(db_path):
        return {}
    con = sqlite3.connect(db_path)
    try:
        _ensure_tables(con)
        rows = con.execute(f'SELECT raw, mapped FROM "{ALIAS_TABLE}" WHERE key = ?',
                           (_key(scope, code, source),)).fetchall()
    finally:
        con.close()
    return {r: m for r, m in rows}


def save_aliases(db_path: str, scope: str, code: str, mapping: dict, source: str = "") -> int:
    """치환 규칙 저장. 값이 비면 그 규칙은 지운다."""
    con = sqlite3.connect(db_path)
    n = 0
    try:
        _ensure_tables(con)
        for raw, mapped in (mapping or {}).items():
            raw = (raw or "").strip()
            mapped = (mapped or "").strip()
            if not raw:
                continue
            if not mapped or mapped == raw:
                con.execute(f'DELETE FROM "{ALIAS_TABLE}" WHERE key = ? AND raw = ?',
                            (_key(scope, code, source), raw))
                continue
            con.execute(
                f'INSERT INTO "{ALIAS_TABLE}" (key, raw, mapped) VALUES (?, ?, ?) '
                "ON CONFLICT(key, raw) DO UPDATE SET mapped = excluded.mapped",
                (_key(scope, code, source), raw, mapped))
            n += 1
        con.commit()
    finally:
        con.close()
    return n


def apply_aliases(rows, aliases: dict):
    """크롤링해 온 팀명을 등록된 팀명으로 치환한다(원본은 _HT_raw/_AT_raw로 남겨 둔다)."""
    if not aliases:
        return rows
    for r in rows:
        for col in ("HT", "AT"):
            raw = r.get(col, "")
            if raw in aliases:
                r[f"_{col}_raw"] = raw
                r[col] = aliases[raw]
    return rows


def unknown_teams(rows, known_teams):
    """치환 후에도 DB에 없는 팀명 목록. 리그에 팀이 하나도 없으면(첫 등록) 검사하지 않는다."""
    known = {str(t).strip() for t in (known_teams or []) if str(t).strip()}
    if not known:
        return []
    seen = []
    for r in rows:
        for col in ("HT", "AT"):
            name = str(r.get(col, "")).strip()
            if name and name not in known and name not in seen:
                seen.append(name)
    return sorted(seen)
