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
    """홍콩식 핸디배당 -> 소수식(1을 더한다). 빈 값이거나 변환 결과가 1.00(=HK 0,
    마켓이 안 열렸을 때의 표기)이면 None."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    dec = round(f + 1.0, 3)
    return None if dec <= 1.0 else dec


def _num(v):
    """양수인 배당이면 float, 아니면(빈값·0·음수·1.00) None.

    1.00은 실제로 나올 수 없는 배당이다(그 결과가 나와도 수익이 0이라는 뜻이라
    배당업체가 절대 안 준다) — 마켓이 안 열렸을 때 채우는 표기로 보인다.
    2026-08-28 국내배당 전수조사에서 확인된 패턴과 같아 여기도 같이 막는다.
    """
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 1.0 else None


def match_books(mid) -> list[dict]:
    """경기 하나의 배당사 전부(스코어맨 12개사) 초기·마감 배당 — DB에 쌓기만 하는 용도.

    한 줄 = 배당사 하나. 값은 전부 소수식(홍콩식 핸디·언더오버는 1을 더한다).
      EU_F1/EU_FX/EU_F2 · EU_L1/EU_LX/EU_L2  승무패(1=홈승 X=무 2=원정승) 초기/마감
      AH_FG · AH_F1 · AH_F2 / AH_LG · AH_L1 · AH_L2  아시안핸디 기준점·홈쪽·원정쪽
          기준점(g)은 스코어맨 원본 그대로 — 음수면 홈이 핸디를 받는다(원정 정배).
          실측: 맨유(홈 언더독) vs 맨시티 g=-0.25.
      OU_FG · OU_FO · OU_FU / OU_LG · OU_LO · OU_LU  언더오버 기준점·오버·언더(u=오버, d=언더)
    """
    d = _get_json(f"{BASE_MATCH}/ajax/soccerajax?type=14&t=1&id={mid}&h=0",
                  f"{BASE_MATCH}/match/data-{mid}")
    out = []
    for c in ((d or {}).get("Data") or {}).get("mixodds") or []:
        def blk(name, stage):
            return ((c.get(name) or {}).get(stage)) or {}
        rec = {"book": c.get("cn"), "cid": c.get("cid")}
        for stage, s in (("f", "F"), ("l", "L")):
            eu, ah, ou = blk("euro", stage), blk("ah", stage), blk("ou", stage)
            rec[f"EU_{s}1"], rec[f"EU_{s}X"], rec[f"EU_{s}2"] = _num(eu.get("u")), _num(eu.get("g")), _num(eu.get("d"))
            rec[f"AH_{s}1"], rec[f"AH_{s}2"] = _dec(ah.get("u")), _dec(ah.get("d"))
            rec[f"AH_{s}G"] = _line(ah.get("g")) if rec[f"AH_{s}1"] else None
            rec[f"OU_{s}O"], rec[f"OU_{s}U"] = _dec(ou.get("u")), _dec(ou.get("d"))
            rec[f"OU_{s}G"] = _line(ou.get("g")) if rec[f"OU_{s}O"] else None
        out.append(rec)
    return out


def _line(v):
    """언더오버 기준점. '3.25'처럼 숫자로 오지만 '2.5/3' 꼴이면 둘의 평균(2.75)으로 읽는다."""
    try:
        return float(v)
    except (TypeError, ValueError):
        pass
    try:
        a, b = str(v).split("/")
        return (float(a) + float(b)) / 2
    except (TypeError, ValueError):
        return None


# 언더오버(오버/기준점/언더) — 리그 표 칸이 아니라 f_ou_odds 테이블로만 간다.
OU_KEYS = ("FOU", "FOUO", "FOUU", "EFOU", "EFOUO", "EFOUU")


def match_odds(mid) -> dict:
    """경기 하나의 Bet365 최초/라이브 배당.

    반환: {'FW','FD','FL','FHW','FHL',            (최초 — 지금 DB에 있는 값과 같은 기준)
           'EFW','EFD','EFL','EFHW','EFHL',       (라이브 = 최종배당)
           'FOU','FOUO','FOUU','EFOU','EFOUO','EFOUU'}  (언더오버 기준점·오버·언더, 최초/라이브)
    Bet365 배당이 없으면 값이 전부 None인 dict.

    [언더오버 칸 — 2026-09-15 실측]
      ou 블록은 u/g/d로 오는데, 스코어맨 경기 화면 자체의 표 틀이 "오버 | 기준점 | 언더"
      머리글 아래 {OUHome}=ou.u, {OUDraw}=ou.g, {OUAway}=ou.d를 채운다 — u=오버, d=언더.
      배당은 핸디처럼 홍콩식이라 1을 더한다(0.95 → 1.95). 기준점은 라인이 배변 때
      움직이므로(3 → 3.25 실측) 최초·라이브를 따로 둔다.
    """
    empty = {k: None for k in
             ("FW", "FD", "FL", "FHW", "FHL", "EFW", "EFD", "EFL", "EFHW", "EFHL") + OU_KEYS}
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
    ou = book.get("ou") or {}
    of, ol = ou.get("f") or {}, ou.get("l") or {}
    return {
        # 언더오버 — u=오버 g=기준점 d=언더(위 주석). 배당이 없으면 기준점도 비운다.
        "FOU": _line(pick(of, "g")) if _dec(pick(of, "u")) else None,
        "FOUO": _dec(pick(of, "u")), "FOUU": _dec(pick(of, "d")),
        "EFOU": _line(pick(ol, "g")) if _dec(pick(ol, "u")) else None,
        "EFOUO": _dec(pick(ol, "u")), "EFOUU": _dec(pick(ol, "d")),
        # 최초 — u=승 g=무 d=패
        "FW": _num(pick(ef, "u")), "FD": _num(pick(ef, "g")), "FL": _num(pick(ef, "d")),
        "FHW": _dec(pick(af, "u")), "FHL": _dec(pick(af, "d")),
        # 라이브(=최종). 핸디 라인(g)은 일부러 안 가져온다(모듈 상단 주석 참고).
        "EFW": _num(pick(el, "u")), "EFD": _num(pick(el, "g")), "EFL": _num(pick(el, "d")),
        "EFHW": _dec(pick(al, "u")), "EFHL": _dec(pick(al, "d")),
    }
