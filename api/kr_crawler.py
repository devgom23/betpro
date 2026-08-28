"""
와이즈토토(wisetoto.com) 국내배당(초기배당) 가져오기.

[왜 젠토토에서 갈아탔나]
  젠토토는 로그인한 크롬 창을 띄워 두고 그 화면을 긁어야 해서, 로그인이 풀리거나
  창을 닫으면 그때마다 실패했다. 와이즈토토는 로그인 없이 그냥 HTTP로 받아올 수
  있어서 브라우저 자체가 필요 없다. 젠토토용 코드는 v2.0에서 지웠다
  (_삭제백업_v2.0/kr_crawler_zentoto_backup.py 와 git 이력에 남아 있다).

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
  · 경기결과(스코어) 수집(_parse_round_results)에서: 킥오프하면 그 순간부터 팀명
    칸에 스코어 숫자가 채워진다 — "스코어 숫자가 있다 = 끝났다"로 오인해서 라이브
    진행 중인 경기의 도중 스코어를 최종 스코어로 잘못 가져온 적이 있다. 결과 칸이
    정확히 '홈승'/'홈패'/'무승부' 셋 중 하나일 때만 끝난 경기로 본다('경기전'도,
    "4'" 같은 경과시간 표시도 전부 걸러진다).
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
    """현재배당 [승,무,패]를 비고 툴팁의 '(기존)' 값으로 되돌린다.

    ⚠ 각 항목(승/무/패)의 '첫' 기록만 쓴다 — 배당이 여러 번 바뀐 경기는 변경 이력이
      여러 벌 쌓이는데, 툴팁은 오래된 것부터 최신 순으로 적혀 있어서 '진짜 초기값'은
      맨 첫 기록의 (기존)이다. 예전엔 순서대로 덮어써서 마지막 기록의 (기존) —
      즉 '끝에서 두 번째 값'을 초기배당으로 잘못 저장했다.
        실측(2026년 100회차 FC서울 vs 부천FC 승):
          이력  1.49 → 1.46 → 1.41 → 1.35 → 1.31 (현재)
          진짜 초기값 1.49 / 예전 코드가 저장하던 값 1.35
      1단계만 바뀐 경기는 우연히 맞아서 오래 안 드러났다(그 회차 배변 28건 중
      2단계 이상이 6건).
    """
    out = list(cur)
    seen = set()
    for tip in tips:
        for m in re.finditer(r"([승무패])\s*\(기존\)\s*([\d.]+)\s*배\s*→\s*\(변경\)", tip):
            key = m.group(1)
            if key in seen:
                continue
            i = _WDL_INDEX.get(key)
            if i is not None and i < len(out):
                out[i] = m.group(2)
                seen.add(key)
    return out


def _parse_round(html, target_league):
    """
    한 회차 HTML에서 그 리그 경기만 뽑는다.
    {matchkey: {HT, AT, date, N/H:초기배당, N2/H2:최종배당}} 형태.

    [초기배당 / 최종배당]
      화면에 찍혀 있는 배당이 곧 '최종배당'(배변이 다 반영된 지금 값)이고,
      거기서 변경 이력을 거꾸로 되짚어 복원한 것이 '초기배당'이다.
      배변이 없던 경기는 둘이 같은 값이 된다(이력이 없으니 복원할 것도 없다).
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

        # 승무패/핸디는 li.hm(핸디 0·음수) 또는 li.hp(핸디 양수, 예: "H +1.0") 가 있는
        # 줄이다. 언더오버(un)·합계마켓(d5)은 이 요소 자체가 없다 — 그런 줄을 승무패로
        # 오인하면 U/O 배당이 승무패 자리에 들어간다.
        # ⚠ li.hp를 안 넣으면 핸디가 "+"로 표기되는 경기(예: 강팀이 원정일 때)는
        # 핸디 배당을 통째로 못 읽는다(2026년 100회차 풀럼/첼시 실측으로 발견).
        hm_el = u.select_one("li.hm, li.hp")
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

        # target_league가 비어 있으면 이 회차의 모든 리그를 담는다(백필처럼 회차 하나를
        # 읽어 8개 리그를 한꺼번에 처리할 때 쓴다 — 리그마다 다시 파싱하면 8배 느리다).
        # 그때 어느 리그였는지 알아야 해서 rec에 league를 같이 넣어 둔다.
        rec = out.setdefault(matchkey, {
            "league": league,
            "HT": h_el.get_text(strip=True), "AT": a_el.get_text(strip=True),
            "date": mh.group(3), "N": None, "H": None,
            "N2": None, "H2": None, "changed": False,
        })
        if changed:
            rec["changed"] = True

        # hm이 빈 문자열일 때만 '정규시간 승무패'다. 전반전 마켓은 앞에 h가 붙어
        # ("h(전반)", "h H -1.0") 비어 있지 않으므로 여기서 자연히 걸러진다 —
        # 아래 핸디 판정도 re.match라 "h H -1.0"은 H로 시작하지 않아 통과 못 한다.
        if not hm:                       # 빈 문자열 = 일반 승무패
            rec["N"] = restored
            rec["N2"] = odds             # 화면 현재값 = 최종배당
        else:
            m = re.match(r"H\s*([+-]?\d+(?:\.\d+)?)", hm)
            # 지금 DB는 ±1 핸디만 다룬다 — 다른 라인(-2.0 등)은 담을 칸이 없어 건너뛴다.
            if m and abs(abs(float(m.group(1))) - 1.0) < 1e-6:
                rec["H"] = restored
                rec["H2"] = odds
    return out


def _num_or_none(v):
    """양수인 배당이면 원래 표기 그대로, 아니면(빈값·0·음수·1.00) None.

    1.00은 와이즈토토가 '이 마켓엔 배당을 안 준다'(경기 특례 등)는 뜻으로 채워 넣는
    표기다 — 실제 배당은 승/무/패 셋이 전부 1.00일 수 없다(배당업체 마진이 마이너스가
    된다). 2026-08-28 6대리그+K1+K2 전수조사로 확인(관련 값 536건 정리).
    """
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f <= 1.0 else v


def _to_row(rec):
    """_parse_round의 한 경기를 저장용 행(초기배당 + 최종배당)으로 편다.

    KH/EKH(핸디 부호)는 채우지 않는다 — 와이즈토토의 'H -1.0' 표기는 "이 줄이 1점 핸디
    마켓"이라는 뜻일 뿐 어느 팀이 핸디를 받았는지가 아니다(수집한 12,600건이 전부
    -1.0으로 같았다). 방향은 저장 시점에 승/패 배당 중 싼 쪽으로 정하므로 여기서
    넘겨짚지 않는다(main.py crawl_save 참고). 초기와 최종은 배당이 크게 움직이면
    정배가 뒤집힐 수 있어 각각 따로 판정한다.
    """
    n = rec["N"] or ["", "", ""]
    h = rec["H"] or ["", "", ""]
    n2 = rec["N2"] or ["", "", ""]
    h2 = rec["H2"] or ["", "", ""]
    return {
        "HT": rec["HT"], "AT": rec["AT"],
        # 초기배당(배변 이력을 되짚어 복원한 값)
        "KW": _num_or_none(n[0]), "KD": _num_or_none(n[1]), "KL": _num_or_none(n[2]),
        "KH": None,
        "KHW": _num_or_none(h[0]), "KHD": _num_or_none(h[1]), "KHL": _num_or_none(h[2]),
        # 최종배당(지금 화면값 — 배변이 없었으면 초기배당과 같다)
        "EKW": _num_or_none(n2[0]), "EKD": _num_or_none(n2[1]), "EKL": _num_or_none(n2[2]),
        "EKH": None,
        "EKHW": _num_or_none(h2[0]), "EKHD": _num_or_none(h2[1]), "EKHL": _num_or_none(h2[2]),
        "_note": "",
    }


# ─────────────────────────── 수집 ───────────────────────────
def fetch_domestic(target_league: str, year, rnd) -> dict:
    """그 회차에서 target_league 경기들의 국내배당(초기배당 + 최종배당)을 가져온다."""
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
        if rec["changed"]:
            changed_cnt += 1
        rows.append(_to_row(rec))

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
        if rec["changed"]:
            changed += 1
        rows.append(_to_row(rec))

    return {
        "round_id": " + ".join(used),
        "count": len(rows),
        "fail_cnt": 0,
        "changed_cnt": changed,
        "rows": rows,
    }


# 일반 승무패 줄의 '결과' 칸(클래스 없는 li)에 나오는, 완전히 끝난 경기만 뜻하는 값.
# ⚠ 실측으로 잡은 버그: 킥오프하면 그 순간부터 팀명 칸에 스코어 숫자가 채워진다.
# "팀명 뒤에 숫자가 있으면 끝난 경기"로 오인해 라이브 중인 경기(0분~90분 진행 중,
# 결과 칸이 "4'"처럼 경과 시간으로 표시됨)의 도중 스코어를 최종 스코어로 잘못
# 가져온 적이 있다 — 그래서 숫자 유무가 아니라 이 화이트리스트로만 종료를 판정한다.
_FINISHED_RESULTS = {"홈승", "홈패", "무승부"}


def _parse_round_results(html, target_league):
    """한 회차 HTML에서 그 리그의 '완전히 끝난' 경기 스코어만 뽑는다.

    한 경기는 승무패/핸디/언더오버/홀짝 여러 줄로 반복되는데, 핸디 줄(H -1 등)의
    스코어 칸은 핸디가 보정된 값이라 실제 스코어가 아니다(예: 0:7 실제 스코어가
    핸디 -1 줄에서는 1:7로 나온다). 핸디 표기가 빈 '일반 승무패' 줄만 실제 스코어다.
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

        hm_el = u.select_one("li.hm")
        if hm_el is None:                    # 언더오버·합계마켓 줄 — 팀 스코어 없음
            continue
        if hm_el.get_text(strip=True):        # 핸디 줄 — 스코어가 핸디 보정값이라 제외
            continue

        # 결과 칸(클래스 없는 li) — '경기전'(아직 시작 전)·"4'"같은 경과시간(진행 중)은
        # 전부 건너뛰고, 확정 결과 3종일 때만 스코어를 가져온다.
        result_el = next((li for li in u.find_all("li", recursive=False) if not li.get("class")), None)
        if not result_el or result_el.get_text(strip=True) not in _FINISHED_RESULTS:
            continue

        a6 = u.select_one("li.a6")
        a8 = u.select_one("li.a8")
        if not a6 or not a8:
            continue
        m6 = re.match(r"^(.*?)\s*(\d+)$", a6.get_text(strip=True))
        m8 = re.match(r"^(\d+)\s*(.*)$", a8.get_text(strip=True))
        if not m6 or not m8:
            continue
        ht, hs = m6.group(1).strip(), m6.group(2)
        as_, at = m8.group(1), m8.group(2).strip()
        if not ht or not at:
            continue
        out[(ht, at)] = {"HT": ht, "AT": at, "HS": int(hs), "AS": int(as_)}
    return out


def fetch_results(target_league: str, year, rnd) -> dict:
    """그 회차에서 target_league의 끝난 경기 스코어를 가져온다."""
    html = fetch_round_html(year, rnd)
    if html is None:
        raise CrawlError(f"{year}년 {rnd}회차를 찾지 못했습니다. 연도·회차를 확인해 주세요.")
    matches = _parse_round_results(html, target_league)
    return {"round_id": f"{year}-{rnd}", "count": len(matches), "rows": list(matches.values())}


def fetch_results_by_dates(target_league: str, d0: datetime, d1: datetime) -> dict:
    """날짜 범위로 회차를 스스로 찾아 그 리그의 끝난 경기 스코어를 모아 온다.

    fetch_by_dates(배당)와 회차 탐색 로직은 같다 — 다른 점은 매치가 하나도 안 끝났어도
    (전부 예정 경기여도) 오류로 보지 않고 빈 목록을 그대로 돌려준다는 것뿐이다.
    """
    years = sorted({d0.year, d1.year})
    rounds = []
    for y in years:
        lo = d0 if d0.year == y else datetime(y, 1, 1)
        hi = d1 if d1.year == y else datetime(y, 12, 31)
        for rnd in find_rounds_for_dates(y, lo, hi):
            rounds.append((y, rnd))
    if not rounds:
        raise CrawlError(
            f"{d0:%Y-%m-%d}~{d1:%Y-%m-%d}에 열린 프로토 회차가 없습니다.")

    merged, used = {}, []
    for y, rnd in rounds:
        html = fetch_round_html(y, rnd)
        if not html:
            continue
        got = _parse_round_results(html, target_league)
        if got:
            used.append(f"{y}년 {rnd}회차")
            merged.update(got)

    return {"round_id": " + ".join(used), "count": len(merged), "rows": list(merged.values())}


# ─────────── 젠토토 시절 인터페이스 (브라우저를 안 쓰므로 무동작) ───────────
# 창을 열고 닫던 open_round/close_page 는 v2.0에서 지웠다(그걸 부르던 엔드포인트
# /api/crawl/kr/open·close 가 화면에서 안 쓰여 같이 삭제됨).
# is_open 만 남는다 — /api/crawl/kr/config 응답이 아직 이 값을 담아 내려준다.
def is_open() -> bool:
    return False
