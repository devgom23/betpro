"""스코어맨 해외배당 '최초/라이브' 가져오기 (브라우저 없이 HTTP만).

[왜 따로 만들었나]
  기존 crawler.py는 크롬 창을 띄워 리그 화면을 긁는다. 그 화면에는 배당이 한 벌
  (=최초배당)만 나와서 배변(배당변경)을 볼 수 없었다. 스코어맨이 내부적으로 쓰는
  JSON을 직접 부르면 최초·라이브를 둘 다 받을 수 있고, 브라우저도 필요 없다.

[두 단계]
  ① 시즌 일정  jsData/matchResult/json/{시즌}/s{리그ID}_kr.json
       한 번에 그 시즌 전 라운드의 경기ID·팀명·킥오프시각이 다 들어 있다.
  ② 경기별 배당 ajax/soccerajax?type=14&t=1&id={경기ID}
       배당사 12곳의 승무패(euro)·핸디(ah)가 f(최초)/l(라이브)로 나뉘어 온다.
       실측으로 2013년 경기까지 남아 있다.

[Bet365만 쓰는 이유]
  지금 DB에 들어 있는 해외배당이 Bet365 최초배당과 정확히 일치한다(실측: 리버풀 vs
  노팅엄 1.42/4.5/6.5, 핸디 1.98/1.88이 한 자리도 안 틀림). 다른 배당사를 섞으면
  과거 데이터와 기준이 어긋나므로 Bet365(cid=8)로 고정한다.

[핸디 배당은 홍콩식이라 1을 더한다]
  JSON의 ah 배당은 0.98처럼 홍콩식으로 온다. 화면·DB가 쓰는 소수식은 여기에 1을
  더한 값이다(0.98 -> 1.98). 실측으로 확인했다.

[핸디 라인(g)은 저장하지 않는다]
  해외는 아시안 핸디캡이라 라인이 1 / 1.25 / 1.5로 잘게 나뉘고, 배변이 일어나면
  라인 자체가 바뀌기도 한다(pinnacle 최초 1.25 -> 라이브 1 실측). 이 시스템은
  FH를 ±1 방향으로만 쓰므로 라인은 안 받고 배당만 쓴다. 방향(FH/EFH)은 저장 시점에
  승/패 배당 중 싼 쪽으로 정한다(main.py crawl_save와 같은 규칙).
"""
import json
import threading
import time

import requests

BASE_LEAGUE = "https://football.scoreman123.com"
BASE_MATCH = "https://www.scoreman123.com"

HDR = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
}

BET365_CID = 8          # 배당사 고정 (위 주석 참고)

_lock = threading.Lock()
_session = None


class OddsError(RuntimeError):
    """사용자에게 그대로 보여줄 오류."""


def _sess():
    global _session
    with _lock:
        if _session is None:
            _session = requests.Session()
            _session.headers.update(HDR)
        return _session


def _get_json(url, referer, timeout=20, tries=3):
    """⚠ Referer만 넣고 X-Requested-With를 빼면 ajax/soccerajax가 {"code":1001/1002}로
    거절한다(실측 — 헤더 하나 차이로 전부 실패했다가 이걸 넣으니 20연속 정상)."""
    last = None
    for i in range(tries):
        try:
            r = _sess().get(url, headers={"Referer": referer, "X-Requested-With": "XMLHttpRequest"},
                            timeout=timeout)
            if r.status_code != 200:
                last = f"HTTP {r.status_code}"
                time.sleep(0.5 * (i + 1))
                continue
            # 시즌 일정 파일은 BOM이 붙어 온다 — utf-8-sig로 읽어야 한다.
            return json.loads(r.content.decode("utf-8-sig", errors="replace"))
        except Exception as e:                      # noqa: BLE001 — 네트워크 오류는 재시도
            last = e
            time.sleep(0.5 * (i + 1))
    raise OddsError(f"스코어맨에 연결하지 못했습니다: {last}")


def season_list(league_id) -> list:
    """그 리그에 있는 시즌 표기 목록(예: ['2026-2027', ...] 또는 ['2026', ...])."""
    d = _get_json(f"{BASE_LEAGUE}/jsData/leagueSeason/sea{league_id}.json",
                  f"{BASE_LEAGUE}/league/{league_id}")
    return list(d.get("SeasonList") or [])


def season_schedule(league_id, season) -> list:
    """그 시즌 전 경기 목록.

    반환: [{'mid':경기ID, 'HT':홈팀, 'AT':원정팀, 'dt':'2026-08-29 19:30', 'R':'2R'}, ...]
    없는 시즌이면 빈 목록.
    """
    try:
        d = _get_json(f"{BASE_LEAGUE}/jsData/matchResult/json/{season}/s{league_id}_kr.json",
                      f"{BASE_LEAGUE}/league/{league_id}")
    except OddsError:
        return []
    teams = {t[0]: t[1] for t in (d.get("TeamInfo") or []) if isinstance(t, list) and t}
    out = []

    def walk(node):
        """ScheduleList 모양이 리그마다 다르다 — 라운드 목록이 나올 때까지 파고든다.

        6대리그: {'R_1': [경기...], 'R_2': [...]}
        K리그  : {'sub_313': {'R_1': [경기...], ...}}   ← 한 단계 더 들어가 있다
        """
        if not isinstance(node, dict):
            return
        for key, val in node.items():
            if isinstance(val, dict):
                walk(val)
                continue
            rnd = str(key).split("_")[-1]
            for g in val or []:
                # [0]=경기ID [3]=킥오프 [4]=홈팀ID [5]=원정팀ID
                if not isinstance(g, list) or len(g) < 6:
                    continue
                # 리그·시즌에 따라 팀ID 자리(g[4]/g[5])가 리스트 등 해시 불가능한
                # 값으로 오는 경우가 있다 — 그런 경기는 팀명 없이("") 건너뛴다.
                ht_id, at_id = g[4], g[5]
                out.append({
                    "mid": str(g[0]),
                    "R": f"{rnd}R" if rnd.isdigit() else rnd,
                    "dt": str(g[3] or ""),
                    "HT": teams.get(ht_id, "") if isinstance(ht_id, (str, int)) else "",
                    "AT": teams.get(at_id, "") if isinstance(at_id, (str, int)) else "",
                })

    walk(d.get("ScheduleList") or {})
    return out


def _dec(v):
    """홍콩식 핸디배당 -> 소수식(1을 더한다). 빈 값이면 None."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f + 1.0, 3)


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def match_odds(mid) -> dict:
    """경기 하나의 Bet365 최초/라이브 배당.

    반환: {'FW','FD','FL','FHW','FHL',            (최초 — 지금 DB에 있는 값과 같은 기준)
           'EFW','EFD','EFL','EFHW','EFHL'}       (라이브 = 최종배당)
    Bet365 배당이 없으면 값이 전부 None인 dict.
    """
    empty = {k: None for k in
             ("FW", "FD", "FL", "FHW", "FHL", "EFW", "EFD", "EFL", "EFHW", "EFHL")}
    d = _get_json(f"{BASE_MATCH}/ajax/soccerajax?type=14&t=1&id={mid}&h=0",
                  f"{BASE_MATCH}/match/data-{mid}")
    mix = ((d or {}).get("Data") or {}).get("mixodds") or []
    book = next((c for c in mix if c.get("cid") == BET365_CID), None)
    if not book:
        return empty

    euro = book.get("euro") or {}
    ah = book.get("ah") or {}

    def pick(blk, key):
        return (blk or {}).get(key)

    ef, el = euro.get("f") or {}, euro.get("l") or {}
    af, al = ah.get("f") or {}, ah.get("l") or {}
    return {
        # 최초 — u=승 g=무 d=패
        "FW": _num(pick(ef, "u")), "FD": _num(pick(ef, "g")), "FL": _num(pick(ef, "d")),
        "FHW": _dec(pick(af, "u")), "FHL": _dec(pick(af, "d")),
        # 라이브(=최종). 핸디 라인(g)은 일부러 안 가져온다(모듈 상단 주석 참고).
        "EFW": _num(pick(el, "u")), "EFD": _num(pick(el, "g")), "EFL": _num(pick(el, "d")),
        "EFHW": _dec(pick(al, "u")), "EFHL": _dec(pick(al, "d")),
    }
