"""
와이즈토토(wisetoto.com) 국내배당(초기배당) 가져오기.

[왜 젠토토에서 갈아탔나]
  젠토토는 로그인한 크롬 창을 띄워 두고 그 화면을 긁어야 해서, 로그인이 풀리거나
  창을 닫으면 그때마다 실패했다. 와이즈토토는 로그인 없이 그냥 HTTP로 받아올 수
  있어서 브라우저 자체가 필요 없다. 젠토토용 코드는 kr_crawler_zentoto_backup.py에
  그대로 남겨 뒀다.

[동작 방식]
  ① index.htm 에서 그 회차의 game_info_master_seq 를 뽑고
  ② util/gameinfo/get_proto_list.htm 로 그 회차 경기 목록을 받아
  ③ 원하는 리그(예: 'K리그1') 줄만 골라 승무패/핸디 배당을 읽는다.
  회차는 '연도 + 그 해의 회차번호'로 지정한다(예: 2026년 99회차).

[초기배당 복원 — 젠토토와 같은 원리]
  배당이 바뀐 경기는 비고에 변경 이력이 툴팁으로 붙어 있다:
      msgset_list('승 (기존) 2.10 배 → (변경) 2.05 배 ...')
  여기서 '(기존)' 값을 읽어 현재배당을 초기배당으로 되돌린다. 이력이 없으면 지금
  배당이 곧 초기배당이다.

[반드시 지켜야 하는 두 가지 — 실측으로 잡은 버그]
  · 인코딩을 UTF-8로 못박는다. 응답 Content-Type 에 charset 이 없어서 requests 가
    요청마다 다르게 추측하고, 가끔 EUC-KR 로 잘못 읽어 팀명이 통째로 깨졌다.
  · <li class="hm"> 이 아예 없는 줄(언더오버 'un', 합계마켓 'd5')은 건너뛴다.
    이걸 '핸디 표기가 빈 줄 = 일반 승무패'로 오인해서 U/O 배당을 승무패 자리에
    덮어썼던 적이 있다.
"""
import re
import threading
import time
from datetime import datetime

import requests
from bs4 import BeautifulSoup

BASE = "https://www.wisetoto.com"
HDR = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Referer": f"{BASE}/index.htm",
    "X-Requested-With": "XMLHttpRequest",
}

_lock = threading.Lock()
_session = None

# 배당 3칸의 순서(승/무/패) — 초기배당 복원 때 어느 칸을 되돌릴지 짚는 데 쓴다.
_WDL_INDEX = {"승": 0, "무": 1, "패": 2}


class CrawlError(RuntimeError):
    """크롤링 중 사용자에게 그대로 보여줄 오류."""


def _sess():
    global _session
    with _lock:
        if _session is None:
            _session = requests.Session()
            _session.headers.update(HDR)
        return _session


def _get_text(url, params=None, timeout=25):
    """응답을 UTF-8로 못박아 읽는다(모듈 상단 주석 참고)."""
    last = None
    for _ in range(2):
        try:
            r = _sess().get(url, params=params, timeout=timeout)
            return r.content.decode("utf-8", errors="replace")
        except Exception as e:       # noqa: BLE001 — 네트워크 오류는 그대로 재시도
            last = e
            time.sleep(1)
    raise CrawlError(f"와이즈토토에 연결하지 못했습니다: {last}")


# ─────────────────────────── 회차 조회 ───────────────────────────
def _game_seq(year, rnd):
    """그 회차의 game_info_master_seq. 없는 회차면 None."""
    html = _get_text(f"{BASE}/index.htm", params={
        "tab_type": "proto", "game_type": "pt", "game_category": "pt1",
        "game_year": year, "game_round": rnd,
    })
    m = re.search(
        r"get_gameinfo_body\('proto',\s*'pt1',\s*'?" + str(year)
        + r"'?,\s*'" + str(rnd) + r"',\s*'',\s*'',\s*'(\d+)'", html)
    return m.group(1) if m else None


def fetch_round_html(year, rnd):
    """그 회차의 축구 경기 목록 HTML. 없는 회차면 None."""
    seq = _game_seq(year, rnd)
    if not seq:
        return None
    return _get_text(f"{BASE}/util/gameinfo/get_proto_list.htm", params={
        "game_category": "pt1", "game_year": year, "game_round": rnd,
        "game_month": "", "game_day": "", "game_info_master_seq": seq,
        "sports": "sc", "sort": "", "tab_type": "proto",
    })


_dates_cache = {}


def _round_dates(year, rnd):
    """그 회차에 걸린 경기 날짜들. 없는 회차면 빈 목록.

    회차 자동 탐색이 한 회차를 여러 번 들여다보므로 캐시해 둔다 — 캐시가 없으면
    이분탐색 한 번에 HTTP 요청이 수십 번 나간다.
    """
    key = (str(year), str(rnd))
    if key in _dates_cache:
        return _dates_cache[key]
    html = fetch_round_html(year, rnd)
    out = []
    if html:
        for mo, dd in re.findall(r'<li class="a2">\s*(\d{2})\.(\d{2})', html):
            try:
                out.append(datetime(int(year), int(mo), int(dd)))
            except ValueError:
                pass
    _dates_cache[key] = out
    return out


def _last_round(year, hi=175):
    """그 해에 실제로 존재하는 마지막 회차. 위쪽은 통째로 비어 있으므로 경계를 먼저 찾는다."""
    lo, best = 1, 0
    while lo <= hi:
        mid = (lo + hi) // 2
        if _round_dates(year, mid):
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return best


def find_rounds_for_dates(year, d0, d1, hi=175):
    """d0~d1(날짜) 사이 경기가 들어 있는 회차 번호들을 찾는다.

    한 라운드가 여러 회차에 걸치는 일이 흔하다(프로토는 금~화 / 수~목으로 끊는데
    리그 라운드는 그 경계를 안 지킨다) — 그래서 하나가 아니라 목록으로 돌려준다.

    ⚠ 이분탐색을 그냥 돌리면 안 된다. 아직 안 열린 위쪽 회차(예: 2026년 120회차)가
    비어 있는데, 빈 회차를 만났다고 위쪽을 버리면 그보다 앞에 있는 정답까지 같이
    잘려 나간다(분데스 30R 실측 — 4월 경기인데 '회차를 못 찾음'이 났다).
    그래서 먼저 '실제로 존재하는 마지막 회차'를 찾아 탐색 상한으로 삼는다.
    """
    top = _last_round(year, hi)
    if not top:
        return []

    lo, start = 1, None
    hi_bound = top
    while lo <= hi_bound:
        mid = (lo + hi_bound) // 2
        ds = _round_dates(year, mid)
        if not ds:                     # 중간에 빠진 회차 — 바로 아래를 이어서 본다
            hi_bound = mid - 1
            continue
        if max(ds) >= d0:
            start = mid
            hi_bound = mid - 1
        else:
            lo = mid + 1
    if start is None:
        return []
    hi = top

    found, rnd, empty = [], start, 0
    while rnd <= hi and empty < 5:
        ds = _round_dates(year, rnd)
        if not ds:
            empty += 1
            rnd += 1
            continue
        empty = 0
        if min(ds) > d1:
            break
        if max(ds) >= d0:
            found.append(rnd)
        rnd += 1
    return found


def round_leagues(year, rnd):
    """그 회차에 들어 있는 리그 이름 목록 — 리그명을 뭐라고 써야 하는지 화면에서 고르게."""
    html = fetch_round_html(year, rnd)
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    names = []
    for u in soup.select("div.gameinfo ul"):
        a4 = u.select_one("li.a4")
        if not a4:
            continue
        nm = a4.get_text(strip=True)
        if nm and nm not in names:
            names.append(nm)
    return sorted(names)


# ─────────────────────────── 파싱 ───────────────────────────
def _restore_initial(cur, tips):
    """현재배당 [승,무,패]를 비고 툴팁의 '(기존)' 값으로 되돌린다."""
    out = list(cur)
    for tip in tips:
        for m in re.finditer(r"([승무패])\s*\(기존\)\s*([\d.]+)\s*배\s*→\s*\(변경\)", tip):
            i = _WDL_INDEX.get(m.group(1))
            if i is not None and i < len(out):
                out[i] = m.group(2)
    return out


def _parse_round(html, target_league):
    """
    한 회차 HTML에서 그 리그 경기만 뽑는다.
    {matchkey: {HT, AT, date, N:[승무패], H:[핸승,핸무,플핸]}} 형태.
    """
    soup = BeautifulSoup(html, "html.parser")
    out = {}
    for u in soup.select("div.gameinfo ul"):
        a4 = u.select_one("li.a4")
        if not a4:
            continue
        league = a4.get_text(strip=True)
        if target_league and league != target_league:
            continue

        # 승무패/핸디는 li.hm 이 있는 줄이다. 언더오버(un)·합계마켓(d5)은 이 요소 자체가
        # 없다 — 그런 줄을 승무패로 오인하면 U/O 배당이 승무패 자리에 들어간다.
        hm_el = u.select_one("li.hm")
        if hm_el is None:
            continue
        hm = hm_el.get_text(" ", strip=True)

        h_el = u.select_one("li.a6 span.tn, li.a6 span.tnb")
        a_el = u.select_one("li.a8 span.tn, li.a8 span.tnb")
        if not h_el or not a_el:
            continue
        mh = re.search(r"tr\('(\d+)','(\d+)','([^']+)'", h_el.get("onclick") or "")
        if not mh:
            continue
        matchkey = f"{mh.group(1)}_{mh.group(2)}_{mh.group(3)}"

        odds = []
        for li in u.select("li.a9"):
            txt = re.sub(r"[^\d.]", "", li.get_text(" ", strip=True))
            odds.append(txt if txt else "")
        if len(odds) < 3:
            continue
        odds = odds[:3]
        tips = re.findall(r"msgset_list\('([^']*)'\)", str(u))
        restored = _restore_initial(odds, tips)
        changed = bool(tips) and restored != odds

        rec = out.setdefault(matchkey, {
            "HT": h_el.get_text(strip=True), "AT": a_el.get_text(strip=True),
            "date": mh.group(3), "N": None, "H": None, "changed": False,
        })
        if changed:
            rec["changed"] = True

        if not hm:                       # 빈 문자열 = 일반 승무패
            rec["N"] = restored
        else:
            m = re.match(r"H\s*([+-]?\d+(?:\.\d+)?)", hm)
            # 지금 DB는 ±1 핸디만 다룬다 — 다른 라인(-2.0 등)은 담을 칸이 없어 건너뛴다.
            if m and abs(abs(float(m.group(1))) - 1.0) < 1e-6:
                rec["H"] = restored
    return out


def _num_or_none(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f <= 0 else v


# ─────────────────────────── 수집 ───────────────────────────
def fetch_domestic(target_league: str, year, rnd) -> dict:
    """
    그 회차에서 target_league 경기들의 국내배당(초기배당 기준)을 가져온다.

    KH(핸디 부호)는 채우지 않는다 — 와이즈토토의 'H -1.0' 표기는 "이 줄이 1점 핸디
    마켓"이라는 뜻일 뿐 어느 팀이 핸디를 받았는지가 아니다(수집한 12,600건이 전부
    -1.0으로 같았다). 방향은 저장 시점에 국내배당(KW/KL) 기준으로 정하므로 여기서
    넘겨짚지 않는다.
    """
    html = fetch_round_html(year, rnd)
    if html is None:
        raise CrawlError(f"{year}년 {rnd}회차를 찾지 못했습니다. 연도·회차를 확인해 주세요.")

    matches = _parse_round(html, target_league)
    if not matches:
        found = round_leagues(year, rnd)
        hint = f" 이 회차에 있는 리그: {', '.join(found)}" if found else ""
        raise CrawlError(
            f"{year}년 {rnd}회차에서 '{target_league}' 경기를 찾지 못했습니다.{hint}")

    rows = []
    changed_cnt = 0
    for rec in matches.values():
        n = rec["N"] or ["", "", ""]
        h = rec["H"] or ["", "", ""]
        if rec["changed"]:
            changed_cnt += 1
        rows.append({
            "HT": rec["HT"], "AT": rec["AT"],
            "KW": _num_or_none(n[0]), "KD": _num_or_none(n[1]), "KL": _num_or_none(n[2]),
            "KH": None,                       # 위 주석 참고 — 방향은 저장 때 배당으로 정한다
            "KHW": _num_or_none(h[0]), "KHD": _num_or_none(h[1]), "KHL": _num_or_none(h[2]),
            "_note": "",
        })

    return {
        "round_id": f"{year}-{rnd}",
        "count": len(rows),
        "fail_cnt": 0,          # 초기배당을 툴팁에서 바로 복원하므로 조회 실패가 없다
        "changed_cnt": changed_cnt,
        "rows": rows,
    }


def fetch_by_dates(target_league: str, d0: datetime, d1: datetime) -> dict:
    """날짜 범위로 회차를 스스로 찾아 그 리그 경기를 모아 온다.

    사용자가 회차 번호를 알 필요가 없게 하려고 만든 입구다. 시즌이 해를 넘기면
    (예: 26-27시즌의 8월과 이듬해 2월) 두 해를 다 뒤져야 해서 연도별로 나눠 찾는다.
    """
    years = sorted({d0.year, d1.year})
    rounds = []
    for y in years:
        lo = d0 if d0.year == y else datetime(y, 1, 1)
        hi = d1 if d1.year == y else datetime(y, 12, 31)
        for rnd in find_rounds_for_dates(y, lo, hi):
            rounds.append((y, rnd))
    if not rounds:
        # 그 주에 프로토 회차 자체가 없는 경우가 실제로 있다(2026년 4/13~4/21 공백 —
        # 분데스 25-26 30R 실측). 경기는 열렸지만 국내배당이 아예 없는 것이라,
        # 회차를 직접 넣어도 나오지 않는다는 걸 분명히 알려 준다.
        raise CrawlError(
            f"{d0:%Y-%m-%d}~{d1:%Y-%m-%d}에 열린 프로토 회차가 없습니다. "
            "그 기간에는 국내배당 자체가 발행되지 않은 것으로 보입니다.")

    merged, changed, used = {}, 0, []
    for y, rnd in rounds:
        html = fetch_round_html(y, rnd)
        if not html:
            continue
        got = _parse_round(html, target_league)
        if not got:
            continue
        used.append(f"{y}년 {rnd}회차")
        for key, rec in got.items():
            merged[key] = rec

    if not merged:
        # 그 날짜 회차는 찾았는데 그 리그가 없는 경우 — 리그명 표기를 알려준다
        names = []
        for y, rnd in rounds[:3]:
            names += [n for n in round_leagues(y, rnd) if n not in names]
        hint = f" 이 기간 회차에 있는 리그: {', '.join(names)}" if names else ""
        raise CrawlError(f"'{target_league}' 경기를 찾지 못했습니다.{hint}")

    rows = []
    for rec in merged.values():
        n = rec["N"] or ["", "", ""]
        h = rec["H"] or ["", "", ""]
        if rec["changed"]:
            changed += 1
        rows.append({
            "HT": rec["HT"], "AT": rec["AT"],
            "KW": _num_or_none(n[0]), "KD": _num_or_none(n[1]), "KL": _num_or_none(n[2]),
            "KH": None,
            "KHW": _num_or_none(h[0]), "KHD": _num_or_none(h[1]), "KHL": _num_or_none(h[2]),
            "_note": "",
        })

    return {
        "round_id": " + ".join(used),
        "count": len(rows),
        "fail_cnt": 0,
        "changed_cnt": changed,
        "rows": rows,
    }


# ─────────── 젠토토 시절 인터페이스 (브라우저를 안 쓰므로 전부 무동작) ───────────
# main.py의 /api/crawl/kr/open·close 가 아직 이 이름들을 부른다. 와이즈토토는 창을
# 열 필요가 없어 호출돼도 아무 일도 하지 않고, 화면에서도 '화면 열기' 단계를 없앴다.
def is_open() -> bool:
    return False


def close_page():
    return True


def open_round(year, rnd) -> str:
    """열 창이 없다. 회차가 실제로 있는지만 확인해 준다."""
    if not _game_seq(year, rnd):
        raise CrawlError(f"{year}년 {rnd}회차를 찾지 못했습니다.")
    return f"{BASE}/index.htm?tab_type=proto&game_type=pt&game_category=pt1&game_year={year}&game_round={rnd}"
