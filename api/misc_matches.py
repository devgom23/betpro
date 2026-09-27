"""'기타경기' — 6대리그·K1·K2를 뺀 모든 축구 경기를 프로토 회차별로 모은다(2026-09-27 사용자 지정).

목적: 6대리그 통합 + K1·K2로 쌓은 데이터를 학습 대상 삼아, 이 경기들의 승부를 국배(국내 승무패
배당) 기준으로 예측한다. 이 리그 자체는 26개 지표를 계산하지 않는다(engine.py를 타지 않는다 —
CLAUDE.md의 '절대 건드리면 안 되는 것' 근처에 얼씬거리지 않으려는 목적도 있다). 예측은 방금 만든
'배당 조회'(api/odds_lookup.py)와 같은 방식 — 비슷한 국배의 과거 경기가 실제로 어떻게 났는지를
그대로 보여주고, 그중 가장 적게 나온 결과를 배제해 정무/플핸무로 판정한다(CLAUDE.md 5-1과 같은 틀).

[사용자 확인 없이 제가 정한 것 — 다르면 말씀해 주세요]
  - 수집 범위: 오늘부터 앞으로 COLLECT_DAYS일 안에 열리는 회차만(사용자가 '오늘 이후 회차부터'로
    확정). 버튼을 누를 때마다 그 범위를 다시 훑어 새 경기는 추가하고, 이미 있는 경기는 결과만 채운다.
  - 비슷함 폭: ±0칸부터 시작해 표본이 1건이라도 나올 때까지 넓힌다(표본 섹션과 같은 방식),
    최대 WIDEN_MAX칸.
  - 표본 기준: n<SAMPLE_WEAK 이면 판정은 내리되 '표본적음'만 표시한다(사용자 지정 — "다 내주고
    표본적음 정도만 알려줘").
  - 판정 규칙: 과거 결과(RT) 중 핸승·역 개수만 비교해 적은 쪽을 배제 — 핸승이 적으면 플핸무,
    역이 적으면 정무(verdictCalc.js pickName과 같은 규칙, 가중치는 안 쓰고 단순 건수 비교).
"""
import re
import sqlite3
from datetime import datetime, timedelta

import pandas as pd

import betpro_paths as PATHS
import data_access as DATA
import kr_crawler as KRCRAWL
import odds_lookup as ODDSLOOK
import user_leagues as USERLG

LEAGUE_LABEL = "기타경기"
DDONG_MAX = 1.49   # api/main.py·data_access.py DDONG_MAX와 같은 값 — 국배(KW/KL) 중 낮은 쪽이 이하면 똥배
COLLECT_DAYS = 10          # '새 회차 가져오기'가 오늘부터 앞으로 훑는 날수
WIDEN_MAX = 10              # 비슷함 폭을 넓히는 한계(칸)
SAMPLE_WEAK = 30            # 이보다 표본이 적으면 '표본적음' 표시(codebase 관례 SAMPLE_RELIABLE_N과 동일)
COLS = ["S", "R", "No", "LG", "HT", "AT", "DT", "TM", "HS", "AS", "RT",
        "KW", "KD", "KL", "KH", "KHW", "KHD", "KHL",
        "EKW", "EKD", "EKL", "EKHW", "EKHD", "EKHL"]


def _num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x > 1.0 else None


def ensure_league(udb: str) -> str:
    """'기타경기' 리그가 없으면 만들고 코드를 돌려준다."""
    for lg in USERLG.list_leagues(udb):
        if lg["label"] == LEAGUE_LABEL:
            return lg["code"]
    return USERLG.create_league(udb, LEAGUE_LABEL)["code"]


# exclude_names는 main.py가 계산해서 넘긴다(main.py의 _l_value·KR_LEAGUE_NAME_GUESS를 재사용
# — 여기서 main을 import하면 main → misc_matches → main으로 순환 import가 된다).


def _kh_and_fav(kw, kl):
    """국배로 정배(홈 여부)만 정한다 — 핸디 부호(KH)는 와이즈토토가 안 주므로(K1/K2와 달리
    이 경기들엔 국내 핸디가 원래 없다), 결과 판정도 국배 정배 기준 승무패로만 한다."""
    if kw is None or kl is None or kw == kl:
        return None
    return kw <= kl


def _rt_from_score(hs, as_, fav_home):
    """국배(승무패)만으로는 RT(핸승·핸무·무·역) 4단계를 낼 수 없다(핸디 기준점이 없어서) —
    그래서 기타경기는 3단계(정배승/무/정배패)로만 결과를 매긴다. 판정(정무/플핸무)과 비교할 때는
    정배승→핸승, 무→무, 정배패→역 자리로 맞춰 쓴다(핸무 칸은 항상 0건)."""
    if hs is None or as_ is None or fav_home is None:
        return None
    diff = hs - as_ if fav_home else as_ - hs
    return 1 if diff > 0 else (3 if diff == 0 else 4)   # RT 2(핸무)는 이 표본엔 없음


def collect(db: str, udb: str, code: str, excl: set) -> dict:
    """'새 회차 가져오기' — 오늘부터 COLLECT_DAYS일 안 회차를 훑어 새 경기를 담고, 이미 담긴
    경기 중 결과 없는 것들의 스코어를 채운다. excl = 제외할 리그명 집합(main.py가 계산)."""
    today = datetime.now()
    rounds = KRCRAWL.rounds_in_range(today, today + timedelta(days=COLLECT_DAYS))

    old = DATA.load_league_df(db, code)
    have = set()
    if not old.empty:
        for s, r, ht, at in zip(old["S"], old["R"], old["HT"], old["AT"]):
            have.add((str(s), str(r), str(ht).strip(), str(at).strip()))

    # 이전 경기도 최종(배변) 배당을 채운다(2026-09-27 사용자 지정) — 오늘 이후 회차 범위
    # 바깥에 있는, 이미 담아 둔 경기 중 EKW가 아직 없는 것들의 회차를 찾아 그것도 같이 훑는다.
    if not old.empty and "EKW" in old.columns:
        need = old[old["EKW"].isna()]
        for s, r in set(zip(need["S"].astype(str), need["R"].astype(str))):
            m = re.match(r"^(\d+)$", s)
            m2 = re.match(r"^(\d+)회차$", r)
            if m and m2:
                pair = (int(m.group(1)), int(m2.group(1)))
                if pair not in rounds:
                    rounds.append(pair)
    if not rounds:
        return {"added": 0, "score_filled": 0, "odds_updated": 0, "rounds": 0,
                "reason": "이 기간에 열린 프로토 회차가 없습니다."}

    new_rows = []
    odds_map = {}   # key → 그 회차에서 지금 읽은 배당(row 그대로) — 배변(최신) 갱신용
    score_map = {}
    for y, rnd in rounds:
        for row in KRCRAWL.fetch_round_all_leagues(y, rnd, excl):
            s, r = str(y), f"{rnd}회차"
            key = (s, r, str(row["HT"]).strip(), str(row["AT"]).strip())
            odds_map[key] = row
            if key not in have:
                new_rows.append({
                    "S": s, "R": r, "No": row.get("gno"), "LG": row.get("LG", ""),
                    "HT": row["HT"], "AT": row["AT"], "DT": row.get("date") or "",
                    "TM": None, "HS": None, "AS": None, "RT": None,
                    "KW": _num(row.get("KW")), "KD": _num(row.get("KD")), "KL": _num(row.get("KL")),
                    "KH": None, "KHW": _num(row.get("KHW")), "KHD": _num(row.get("KHD")), "KHL": _num(row.get("KHL")),
                    "EKW": _num(row.get("EKW")), "EKD": _num(row.get("EKD")), "EKL": _num(row.get("EKL")),
                    "EKHW": _num(row.get("EKHW")), "EKHD": _num(row.get("EKHD")), "EKHL": _num(row.get("EKHL")),
                })
                have.add(key)
        for (lg, ht, at), sc in KRCRAWL.fetch_round_all_results(y, rnd).items():
            if lg in excl:
                continue
            score_map[(str(y), f"{rnd}회차", ht.strip(), at.strip())] = sc

    df = pd.concat([old, pd.DataFrame(new_rows, columns=COLS)], ignore_index=True) if new_rows else old.copy()
    for c in COLS:
        if c not in df.columns:
            df[c] = None if c not in ("HS", "AS", "RT", "KW", "KD", "KL", "KH", "KHW", "KHD", "KHL", "EKW", "EKD", "EKL", "EKHW", "EKHD", "EKHL") else pd.NA
    filled = ekw_updated = 0
    for i in df.index:
        key = (str(df.at[i, "S"]), str(df.at[i, "R"]), str(df.at[i, "HT"]).strip(), str(df.at[i, "AT"]).strip())
        finished = pd.notna(df.at[i, "HS"])
        # 배변(EKW)은 결과가 안 난 경기는 매번 새로 맞추고, 이미 끝난 경기는 '아직 한 번도 못 받은
        # 것만' 채운다(2026-09-27 — "이전 경기도 최종 배당 불러오게 해줘"). 끝난 경기의 배변은
        # 더 안 움직이므로 이미 있으면 덮어쓰지 않는다.
        if not finished or pd.isna(df.at[i, "EKW"]):
            row = odds_map.get(key)
            if row is not None:
                ek = _num(row.get("EKW"))
                if ek is not None:
                    df.at[i, "EKW"], df.at[i, "EKD"], df.at[i, "EKL"] = ek, _num(row.get("EKD")), _num(row.get("EKL"))
                    df.at[i, "EKHW"], df.at[i, "EKHD"], df.at[i, "EKHL"] = _num(row.get("EKHW")), _num(row.get("EKHD")), _num(row.get("EKHL"))
                    ekw_updated += 1
        # 경기일시(DT)도 예전엔 _to_row가 안 내려줘서 빈칸이었다 — 지금 읽은 값이 있고 아직
        # 비어 있으면 채운다(2026-09-27 — "회차 다음에 경기일시 정도는 표기해줘").
        if not str(df.at[i, "DT"] or "").strip():
            row = odds_map.get(key)
            if row and row.get("date"):
                df.at[i, "DT"] = row["date"]
        if not finished:
            sc = score_map.get(key)
            if sc:
                fav = _kh_and_fav(_num(df.at[i, "KW"]), _num(df.at[i, "KL"]))
                rt = _rt_from_score(sc["HS"], sc["AS"], fav)
                df.at[i, "HS"], df.at[i, "AS"] = sc["HS"], sc["AS"]
                if rt is not None:
                    df.at[i, "RT"] = rt
                filled += 1

    if new_rows or filled or ekw_updated:
        with DATA.table_write(db, code):
            con = sqlite3.connect(db)
            try:
                df.to_sql(code, con, if_exists="replace", index=False)
            finally:
                con.close()
            PATHS.stamp_updated(db)

    return {"added": len(new_rows), "score_filled": filled, "odds_updated": ekw_updated, "rounds": len(rounds)}


def _widen_lookup(sources, q, cap=WIDEN_MAX):
    """±0칸부터 표본이 1건 나올 때까지 넓힌다(표본 섹션과 같은 방식) — odds_lookup.lookup은
    고정 tick만 받으므로 여기서 감싼다."""
    for t in range(0, cap + 1):
        r = ODDSLOOK.lookup(sources, q, "init", t, 0, False, "near")
        if r.get("ready") and r["n"] > 0:
            r["tick"] = t
            return r
    return {"ready": False, "n": 0, "tick": cap}


PICK_VERDICT_MAP = {"정무": {"hit": (1, 2), "insure": (3,)}, "플핸무": {"hit": (3, 4), "insure": (2,)}}


def verdict_of(cnt):
    """과거 결과 4칸(핸승,핸무,무,역) 중 핸승·역만 비교해 적은 쪽을 배제 — verdictCalc.js
    pickName과 같은 규칙(가중치 없이 건수만)."""
    hs, _, _, yk = cnt
    return "플핸무" if hs <= yk else "정무"


def build_list(db: str, code: str, mdb: str, udb: str, user_codes: tuple) -> dict:
    """기타경기 목록 + 판정 + 적중 + 요약. 판정용 표본 풀은 6대리그(master) + K1·K2(user, 내
    데이터에서 K1·K2로 등록된 코드) — '기타경기' 자신은 절대 포함하지 않는다."""
    df = DATA.load_league_df(db, code)
    if df.empty:
        return {"rows": [], "summary": None, "code": code, "scope": "user"}
    sources = [(mdb, PATHS.SCOPE_MASTER, c, PATHS.LEAGUE_LABEL.get(c, c)) for c in PATHS.LEAGUES]
    sources += [(udb, PATHS.SCOPE_USER, c, lab) for c, lab in user_codes]

    rows = []
    hit = miss = insure = pending = no_sample = no_odds = 0
    for _, r in df.sort_values(["S", "R"], ascending=False).iterrows():
        kw, kd, kl = _num(r.get("KW")), _num(r.get("KD")), _num(r.get("KL"))
        is_ddong = bool((kw is not None and kw <= DDONG_MAX) or (kl is not None and kl <= DDONG_MAX))
        q = {"KW": kw, "KD": kd, "KL": kl}
        res = _widen_lookup(sources, q) if kw is not None and kl is not None else {"ready": False}
        v = None
        if res.get("ready"):
            v = {"pick": verdict_of(res["cnt"]), "n": res["n"], "pct": res["pct"], "tick": res["tick"],
                 "weak": res["n"] < SAMPLE_WEAK}
        rt = None if pd.isna(r.get("RT")) else int(r["RT"])
        outcome = None
        if v and rt is not None:
            rule = PICK_VERDICT_MAP[v["pick"]]
            outcome = "적중" if rt in rule["hit"] else ("보험" if rt in rule["insure"] else "미적")
            if outcome == "적중":
                hit += 1
            elif outcome == "미적":
                miss += 1
            else:
                insure += 1
        elif v:
            pending += 1
        # 판정 자체를 못 낸 경우(2026-09-27 사용자 제보 — "총 163인데 합이 133건" — 요약에서
        # 이 경우들이 빠져 있었다). 국배(KW·KL)가 있는데도 못 냈으면 표본없음, 국배 자체가
        # 없으면(프로토가 배당을 안 줌) 배당없음 — 화면 판정·적중결과 칸과 같은 기준.
        elif kw is not None and kl is not None:
            no_sample += 1
        else:
            no_odds += 1
        rows.append({
            "S": str(r["S"]), "R": str(r["R"]), "LG": r.get("LG") or "", "HT": r["HT"], "AT": r["AT"],
            "DT": r.get("DT"), "HS": None if pd.isna(r.get("HS")) else int(r["HS"]),
            "AS": None if pd.isna(r.get("AS")) else int(r["AS"]), "RT": rt,
            "KW": kw, "KD": kd, "KL": kl,
            "EKW": _num(r.get("EKW")), "EKD": _num(r.get("EKD")), "EKL": _num(r.get("EKL")),
            # 국핸디(2026-09-27 사용자 제보 — "왜 핸디 배당은 안 보여줘": 값은 이미 받아 저장하고 있었는데
            # 화면·응답 어디에도 안 내보내고 있었다). 기준점(KH)은 와이즈토토가 어느 팀 것인지 안 줘서
            # 항상 비어 있다(_to_row 주석) — 저장 시점에도 안 채우므로 여기서도 못 채운다.
            "KHW": _num(r.get("KHW")), "KHD": _num(r.get("KHD")), "KHL": _num(r.get("KHL")),
            "EKHW": _num(r.get("EKHW")), "EKHD": _num(r.get("EKHD")), "EKHL": _num(r.get("EKHL")),
            # 똥배·똥사(2026-09-27 사용자 지정 — "국배 승무패 초기 컬럼 왼쪽 앞에 표시").
            # 기준은 앱 전체와 같다(api/main.py DDONG_MAX): 국배(초기 KW/KL) 중 낮은 쪽이 1.49 이하면 똥배,
            # 그중 결과가 무·역(정배가 완전히 무너짐)이면 똥사 — 결과가 아직 없으면 똥사는 판단 보류(None).
            "ddong": is_ddong,
            "ddongsa": None if (rt is None or not is_ddong) else (rt in (3, 4)),
            "verdict": v, "outcome": outcome,
        })
    decided = hit + miss  # 보험(insure)은 적중도 미적도 아니라 적중률 분모에서 그대로 뺀다(예전과 동일)
    graded = decided + insure  # "결과 난 경기" = 적중·미적·보험 전부(모두 경기가 끝나 outcome이 확정됨)
    summary = {"total": len(rows), "graded": graded, "hit": hit, "miss": miss, "insure": insure,
              "pending": pending, "no_sample": no_sample, "no_odds": no_odds,
              "rate": round(hit / decided * 100, 2) if decided else None}
    return {"rows": rows, "summary": summary, "code": code, "scope": "user"}


def sample_detail(db: str, code: str, mdb: str, udb: str, user_codes: tuple, s: str, r: str, ht: str, at: str) -> dict:
    """'표본 상세' 팝업(2026-09-27 사용자 지정 — "표본상세를 볼 수 잇는 팝업을 만들어줘"). 목록 한
    줄의 판정이 어떤 과거 경기들로 나왔는지 — build_list와 완전히 같은 방식(같은 비슷함 폭)으로
    다시 찾아, 이번엔 ODDSLOOK.lookup의 rows(매칭된 과거 경기 목록 그대로)까지 돌려준다."""
    df = DATA.load_league_df(db, code)
    m = df[(df["S"].astype(str) == s) & (df["R"].astype(str) == r)
           & (df["HT"].astype(str).str.strip() == ht) & (df["AT"].astype(str).str.strip() == at)]
    if m.empty:
        return {"ready": False, "reason": "경기를 찾지 못했습니다"}
    row = m.iloc[0]
    kw, kd, kl = _num(row.get("KW")), _num(row.get("KD")), _num(row.get("KL"))
    if kw is None or kl is None:
        return {"ready": False, "reason": "이 경기는 국배가 없어 표본을 찾을 수 없습니다"}
    sources = [(mdb, PATHS.SCOPE_MASTER, c, PATHS.LEAGUE_LABEL.get(c, c)) for c in PATHS.LEAGUES]
    sources += [(udb, PATHS.SCOPE_USER, c, lab) for c, lab in user_codes]
    res = _widen_lookup(sources, {"KW": kw, "KD": kd, "KL": kl})
    if not res.get("ready"):
        return {"ready": False, "reason": "비슷한 과거 경기를 하나도 찾지 못했습니다"}
    res["pick"] = verdict_of(res["cnt"])
    res["weak"] = res["n"] < SAMPLE_WEAK
    res["q"] = {"KW": kw, "KD": kd, "KL": kl}
    return res
