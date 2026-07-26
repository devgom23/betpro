"""
엑셀 내보내기 모음.
  · build_match_excel()    상세보기 팝업 1경기를 한 시트로 (팝업과 같은 2단 배치)
  · build_upload_template() 경기 업로드용 빈 표본 양식
  · build_table_excel()    현재 조회된 분석표 그대로

모두 이미 계산·저장되어 있는 값을 옮겨 담을 뿐, 새로 계산하지 않는다.
"""
import io

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# 업로드 양식의 컬럼 — engine.preprocess_data()의 target_cols와 반드시 같아야 한다.
# (여기 순서대로 헤더를 만들어야 업로드 시 그대로 인식됨)
UPLOAD_TEMPLATE_COLS = [
    "L", "S", "R", "No", "DT", "TM", "HT", "HS", "RT", "AS", "AT",
    "KW", "KD", "KL", "KH", "KHW", "KHD", "KHL",
    "FW", "FD", "FL", "FH", "FHW", "FHD", "FHL",
]

# 업로드 양식 각 컬럼의 뜻 — 안내 행에 함께 넣어 비개발자도 채울 수 있게 한다.
UPLOAD_COL_HINTS = {
    "L": "리그", "S": "시즌(예: 25-26)", "R": "라운드(예: 38R)", "No": "경기번호",
    "DT": "일자", "TM": "시각", "HT": "홈팀(필수)", "HS": "홈 득점",
    "RT": "결과(핸승/핸무/무/역·미정이면 공란)", "AS": "원정 득점", "AT": "원정팀(필수)",
    "KW": "국내 홈", "KD": "국내 무", "KL": "국내 원정", "KH": "국내 핸디",
    "KHW": "국내핸디 홈", "KHD": "국내핸디 무", "KHL": "국내핸디 원정",
    "FW": "해외 홈", "FD": "해외 무", "FL": "해외 원정", "FH": "해외 핸디",
    "FHW": "해외핸디 홈", "FHD": "해외핸디 무", "FHL": "해외핸디 원정",
}

RT_LABELS = {1: "핸승", 2: "핸무", 3: "무", 4: "역"}

# MatchDetailModal.jsx SAMPLE_INDICATORS 와 동일한 순서·라벨
SAMPLE_INDICATORS = [
    ("K-W", "국) 승"), ("K-L", "국) 패"), ("K-WL", "국) 승+패"), ("K-WDL", "국) 승+무+패"),
    ("K-W-HT", "국) 승=홈팀"), ("K-L-AT", "국) 패=원정팀"),
    ("TK-W", "국/통) 승"), ("TK-L", "국/통) 패"), ("TK-WDL", "국/통) 승+무+패"),
    ("F-W", "해) 승"), ("F-L", "해) 패"), ("F-WL", "해) 승+패"), ("F-WDL", "해) 승+무+패"),
    ("F-W-HT", "해) 승=홈팀"), ("F-L-AT", "해) 패=원정팀"),
    ("TF-W", "해/통) 승"), ("TF-L", "해/통) 패"), ("TF-WDL", "해/통) 승+무+패"),
]

_HEADER_FILL = PatternFill("solid", fgColor="1F2937")
_HEADER_FONT = Font(bold=True, color="FFFFFF")
_MAX_FILL = PatternFill("solid", fgColor="D4C97A")  # 표의 노란(khaki) 최댓값 강조와 동일 톤
_CENTER = Alignment(horizontal="center", vertical="center")
_THIN = Side(style="thin", color="D1D5DB")
_BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
_TITLE_FONT = Font(bold=True, size=14)
_BOLD = Font(bold=True)


def _rt_label(v):
    if v is None or v == "":
        return None
    try:
        return RT_LABELS.get(int(float(v)))
    except (TypeError, ValueError):
        return None


def _num_or_dash(v, digits=2):
    if v is None or v == "":
        return "-"
    try:
        return round(float(v), digits)
    except (TypeError, ValueError):
        return "-"


def _pct_or_dash(v):
    if v is None or v == "":
        return "-"
    try:
        return f"{float(v):.0f}%"
    except (TypeError, ValueError):
        return "-"


def _int_or_blank(v):
    if v is None or v == "":
        return ""
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return v


_RIGHT_COL = 7  # 'G' — 팝업의 오른쪽 칼럼(상대전적)이 시작하는 위치


def build_match_excel(row: dict, h2h: dict) -> io.BytesIO:
    """
    MatchDetailModal.jsx의 2단 레이아웃(왼쪽: 배당·플핸예측·지표별표본 /
    오른쪽: 상대전적)을 그대로 옮긴다 — 왼쪽은 A열, 오른쪽은 G열에서 시작.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "상세보기"

    def write_row(values, row_idx, start_col=1, font=None, fill=None, align=None):
        for i, v in enumerate(values):
            cell = ws.cell(row=row_idx, column=start_col + i, value=v)
            cell.border = _BORDER
            if font:
                cell.font = font
            if fill:
                cell.fill = fill
            if align:
                cell.alignment = align
        return row_idx + 1

    ht = str(row.get("HT") or "").strip()
    at = str(row.get("AT") or "").strip()
    rt = _rt_label(row.get("RT"))
    hs, as_ = row.get("HS"), row.get("AS")
    has_score = hs is not None and as_ is not None and hs != "" and as_ != ""

    r = 1
    ws.cell(row=r, column=1, value=f"{ht} vs {at}").font = _TITLE_FONT
    r += 1

    meta = f"{row.get('S', '')} · {row.get('R', '')}"
    if row.get("DT"):
        meta += f" · {row.get('DT')}"
    meta += f" · {rt}" if rt else " · 예정 경기"
    ws.cell(row=r, column=1, value=meta)
    r += 1

    if has_score:
        ws.cell(row=r, column=1,
                value=f"{ht} {_int_or_blank(hs)} : {_int_or_blank(as_)} {at}").font = _BOLD
        r += 1
    r += 1
    section_start = r  # 배당/상대전적이 나란히 시작하는 행

    # ── 왼쪽: 배당 → 플핸 예측 → 지표별 표본 ──
    ws.cell(row=r, column=1, value="배당").font = _BOLD
    r += 1
    r = write_row(["구분", "승(홈)", "무", "패(원정)"], r, font=_HEADER_FONT,
                  fill=_HEADER_FILL, align=_CENTER)
    for label, w, d, l in (
        ("국내 배당", "KW", "KD", "KL"),
        ("국내 핸디", "KHW", "KHD", "KHL"),
        ("해외 배당", "FW", "FD", "FL"),
        ("해외 핸디", "FHW", "FHD", "FHL"),
    ):
        r = write_row([label, _num_or_dash(row.get(w)), _num_or_dash(row.get(d)),
                       _num_or_dash(row.get(l))], r)
    r += 1

    ws.cell(row=r, column=1, value="플핸 예측").font = _BOLD
    r += 1
    r = write_row(["해)플핸", "국)플핸", "PICK", "실측", "비중"], r, font=_HEADER_FONT,
                  fill=_HEADER_FILL, align=_CENTER)
    r = write_row([
        _pct_or_dash(row.get("PH_F")),
        _pct_or_dash(row.get("PH_K")),
        row.get("PH_PICK") or "-",
        _pct_or_dash(row.get("PH_HIT")),
        _pct_or_dash(row.get("PH_DOM")),
    ], r)
    r += 1

    ws.cell(row=r, column=1, value="지표별 표본").font = _BOLD
    r += 1
    r = write_row(["지표", "핸승", "핸무", "무", "역", "토탈"], r, font=_HEADER_FONT,
                  fill=_HEADER_FILL, align=_CENTER)
    grand = [0, 0, 0, 0]
    for code, label in SAMPLE_INDICATORS:
        vals = []
        for i in (1, 2, 3, 4):
            try:
                vals.append(int(float(row.get(f"{code} {i}") or 0)))
            except (TypeError, ValueError):
                vals.append(0)
        for i, v in enumerate(vals):
            grand[i] += v
        row_idx = r
        r = write_row([label, *vals, sum(vals)], r)
        vmax = max(vals)
        if vmax > 0:
            for i, v in enumerate(vals):
                if v == vmax:
                    ws.cell(row=row_idx, column=2 + i).fill = _MAX_FILL

    row_idx = r
    r = write_row(["토탈", *grand, sum(grand)], r, font=_BOLD)
    vmax = max(grand)
    if vmax > 0:
        for i, v in enumerate(grand):
            if v == vmax:
                ws.cell(row=row_idx, column=2 + i).fill = _MAX_FILL

    # ── 오른쪽(G열): 상대전적 — 배당과 같은 행(section_start)에서 시작 ──
    rr = section_start
    ws.cell(row=rr, column=_RIGHT_COL, value="상대전적").font = _BOLD
    rr += 1
    ws.cell(row=rr, column=_RIGHT_COL, value="결과는 각 경기의 홈팀 기준입니다.")
    rr += 1
    summary = h2h.get("summary")
    if summary:
        rr = write_row(["핸승", "핸무", "무", "역", "토탈"], rr, start_col=_RIGHT_COL,
                       font=_HEADER_FONT, fill=_HEADER_FILL, align=_CENTER)
        rr = write_row([summary["핸승"], summary["핸무"], summary["무"], summary["역"],
                        summary["총"]], rr, start_col=_RIGHT_COL)
        rr += 1
        rr = write_row(["시즌", "R", "HT", "HS", "AS", "AT", "결과"], rr, start_col=_RIGHT_COL,
                       font=_HEADER_FONT, fill=_HEADER_FILL, align=_CENTER)
        for m in h2h.get("matches", []):
            rr = write_row([
                m.get("S"), m.get("R"), m.get("HT"),
                _int_or_blank(m.get("HS")), _int_or_blank(m.get("AS")), m.get("AT"),
                m.get("RT_label") or "",
            ], rr, start_col=_RIGHT_COL)
        total = h2h.get("total", 0)
        shown = len(h2h.get("matches", []))
        if total > shown:
            ws.cell(row=rr, column=_RIGHT_COL, value=f"최근 {shown}경기만 표시 (총 {total}경기)")
            rr += 1
    else:
        ws.cell(row=rr, column=_RIGHT_COL, value=f"{ht} vs {at} 맞대결 기록 없음")
        rr += 1

    widths = {1: 18, 2: 12, 3: 12, 4: 12, 5: 12, 6: 10,
             7: 10, 8: 10, 9: 10, 10: 10, 11: 10, 12: 10, 13: 10}
    for col, width in widths.items():
        ws.column_dimensions[get_column_letter(col)].width = width

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def build_upload_template() -> io.BytesIO:
    """
    경기 업로드용 빈 표본 양식.

    첫 시트('경기입력')에는 헤더 한 줄만 두고 2행부터 바로 입력하게 한다.
    컬럼 설명을 헤더 아래에 같이 넣으면 업로드할 때 그 설명 줄이 경기 한 건으로
    읽혀 쓰레기 행이 들어가므로(HT/AT가 비어있지 않아 검증도 통과함), 설명은
    반드시 별도 시트에 둔다. pandas는 첫 시트만 읽으므로 안전하다.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "경기입력"

    for i, col in enumerate(UPLOAD_TEMPLATE_COLS, start=1):
        cell = ws.cell(row=1, column=i, value=col)
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = _CENTER
        cell.border = _BORDER
        ws.column_dimensions[get_column_letter(i)].width = 14
    ws.freeze_panes = "A2"

    guide = wb.create_sheet("작성안내")
    guide.cell(row=1, column=1, value="경기 데이터 작성 안내").font = _TITLE_FONT
    notes = [
        "'경기입력' 시트의 2행부터 한 줄에 한 경기씩 입력하세요.",
        "홈팀(HT)과 원정팀(AT)은 반드시 채워야 합니다. 비어 있으면 그 줄은 무시됩니다.",
        "결과(RT)는 핸승 / 핸무 / 무 / 역 중 하나로 적고, 아직 안 끝난 경기는 비워 두세요.",
        "이미 등록된 경기와 시즌·라운드·경기번호·팀이 모두 같으면 새로 올린 값으로 대체됩니다.",
        "컬럼 순서를 바꾸거나 컬럼명을 고치지 마세요.",
    ]
    r = 3
    for n in notes:
        guide.cell(row=r, column=1, value=f"· {n}")
        r += 1
    r += 1

    guide.cell(row=r, column=1, value="컬럼").font = _BOLD
    guide.cell(row=r, column=2, value="설명").font = _BOLD
    r += 1
    for col in UPLOAD_TEMPLATE_COLS:
        guide.cell(row=r, column=1, value=col).font = _BOLD
        guide.cell(row=r, column=2, value=UPLOAD_COL_HINTS.get(col, ""))
        r += 1
    guide.column_dimensions["A"].width = 10
    guide.column_dimensions["B"].width = 42

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


# ════════════════════════════════════════════════════════════
# 분석표 2단 헤더 + 색상 — web/src/components/LeagueTable/columnGroups.js를
# 그대로 옮긴 것. 그룹 구성·라벨·색상 규칙이 어긋나면 안 되므로 순서·값 모두 동일하게 유지.
# ════════════════════════════════════════════════════════════
_GEN_COLS = ["L", "S", "R", "No", "DT", "TM"]
_MATCH_COLS = ["HT", "HS", "RT", "AS", "AT"]
_K_ODDS_COLS = ["KW", "KD", "KL", "KH", "KHW", "KHD", "KHL"]
_F_ODDS_COLS = ["FW", "FD", "FL", "FH", "FHW", "FHD", "FHL"]
_PH_COLS = [
    ("PH_F", "해)플핸"), ("PH_K", "국)플핸"), ("PH_PICK", "PICK"),
    ("PH_HIT", "실측"), ("PH_DOM", "비중"),
]
_GROUP_DEFS = [
    ("F-W", "1. 해) 승 분석"), ("F-L", "2. 해) 패 분석"), ("F-WL", "3. 해) 승+패 분석"),
    ("F-WDL", "4. 해) 승+무+패 분석"), ("F-W-HW", "5. 해) 승+H핸 분석"),
    ("F-W-HT", "6. 해) 승=홈팀 분석"), ("F-L-AT", "7. 해) 패=원정팀 분석"),
    ("F-WL-HT", "8. 해) 승/패=홈팀 분석"), ("F-WL-AT", "9. 해) 승/패=원정팀 분석"),
    ("TF-W", "10. 해/통) 승 분석"), ("TF-L", "11. 해/통) 패 분석"),
    ("TF-WL", "12. 해/통) 승+패 분석"), ("TF-WDL", "13. 해/통) 승+무+패 분석"),
    ("K-W", "14. 국) 승 분석"), ("K-L", "15. 국) 패 분석"), ("K-WL", "16. 국) 승+패 분석"),
    ("K-WDL", "17. 국) 승+무+패 분석"), ("K-W-HW", "18. 국) 승+H핸 분석"),
    ("K-W-HT", "19. 국) 승=홈팀 분석"), ("K-L-AT", "20. 국) 패=원정팀 분석"),
    ("K-WL-HT", "21. 국) 승/패=홈팀 분석"), ("K-WL-AT", "22. 국) 승/패=원정팀 분석"),
    ("TK-W", "23. 국/통) 승 분석"), ("TK-L", "24. 국/통) 패 분석"),
    ("TK-WL", "25. 국/통) 승+패 분석"), ("TK-WDL", "26. 국/통) 승+무+패 분석"),
]
_SUB4 = ["핸승", "핸무", "무", "역"]
_RT_DISPLAY = {1: "핸승", 2: "핸무", 3: "무", 4: "역"}
_RT_CODE_FROM_TEXT = {"핸승": 1, "핸무": 2, "무": 3, "역": 4}

_GROUP_HEADER_FILL = PatternFill("solid", fgColor="1F2937")
_GROUP_HEADER_FONT = Font(bold=True, color="FFFFFF")
_SUB_HEADER_FILL = PatternFill("solid", fgColor="374151")
_SUB_HEADER_FONT = Font(bold=True, color="E5E7EB", size=10)


def _blank(v):
    return v is None or v == ""


def _num(v):
    if _blank(v):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _rt_text(v):
    if _blank(v):
        return ""
    n = _num(v)
    if n is not None:
        return _RT_DISPLAY.get(int(n), "")
    return str(v)


def _rt_code(v):
    if _blank(v):
        return None
    n = _num(v)
    if n is not None:
        return int(n)
    return _RT_CODE_FROM_TEXT.get(str(v).strip())


def build_column_groups(available_cols):
    """columnGroups.js buildColumnGroups()와 동일. 실제로 존재하는 컬럼만 순서대로 배치."""
    available = set(available_cols)
    groups = []

    def add_flat(label1, label2, cols):
        leaves = [{"key": c, "sub": c} for c in cols if c in available]
        if leaves:
            groups.append({"label1": label1, "label2": label2, "kind": "flat", "cols": leaves})

    add_flat("일반정보", "시즌 및 라운드 정보", _GEN_COLS)
    add_flat("경기정보", "홈팀 vs 원정팀", _MATCH_COLS)
    add_flat("국내배당", "승(W) / 무(D) / 패(L)", _K_ODDS_COLS)
    add_flat("해외배당", "승(W) / 무(D) / 패(L)", _F_ODDS_COLS)

    ph_leaves = [{"key": k, "sub": s} for k, s in _PH_COLS if k in available]
    if ph_leaves:
        groups.append({"label1": "플핸 예측", "label2": "26개 지표 기반 · 실측 적중률",
                       "kind": "ph", "cols": ph_leaves})

    for code, title in _GROUP_DEFS:
        leaves = [{"key": f"{code} {i + 1}", "sub": sub} for i, sub in enumerate(_SUB4)
                 if f"{code} {i + 1}" in available]
        if leaves:
            groups.append({"label1": title, "label2": code, "kind": "indicator", "cols": leaves})

    return groups


def _format_cell(group, col, value):
    """columnGroups.js formatCell()과 동일한 표시 규칙."""
    g1, sub = group["label1"], col["sub"]

    if g1 == "경기정보" and sub == "RT":
        return _rt_text(value)
    if g1 == "경기정보" and sub in ("HS", "AS"):
        n = _num(value)
        return "" if n is None else str(int(n))
    if g1 == "일반정보" and sub in ("No", "TM"):
        n = _num(value)
        return "" if n is None else str(int(n))
    if g1 in ("국내배당", "해외배당"):
        n = _num(value)
        if n is None:
            return ""
        if sub in ("KH", "FH"):
            return f"{'+' if n >= 0 else ''}{n:.1f}"
        return f"{n:.2f}"
    if group["kind"] == "ph":
        if sub == "PICK":
            return "" if _blank(value) else str(value)
        n = _num(value)
        return "" if n is None else f"{n:.0f}%"
    if sub in _SUB4:
        n = _num(value)
        return "" if n is None else str(int(n))
    return "" if _blank(value) else str(value)


def _cell_style(group, col, value):
    """columnGroups.js cellStyle()과 동일한 배경/글자색 규칙. {bg, fg, bold} 또는 None."""
    g1, sub = group["label1"], col["sub"]

    if g1 == "경기정보" and sub == "RT":
        code = _rt_code(value)
        return {
            1: {"bg": "1565C0", "fg": "FFFFFF", "bold": True},
            2: {"bg": "64B5F6", "fg": "0D1B2A", "bold": True},
            3: {"bg": "757575", "fg": "FFFFFF", "bold": True},
            4: {"bg": "C62828", "fg": "FFFFFF", "bold": True},
        }.get(code)

    if (g1 == "해외배당" and sub == "FH") or (g1 == "국내배당" and sub == "KH"):
        n = _num(value)
        if n is None:
            return None
        if n < 0:
            return {"fg": "1565C0", "bold": True}
        if n > 0:
            return {"fg": "C62828", "bold": True}
        return None

    if group["kind"] == "ph" and sub == "PICK":
        s = "" if _blank(value) else str(value).strip()
        if s.startswith("플핸"):
            if "(역)" in s:
                return {"bg": "4A148C", "fg": "FFFFFF", "bold": True}
            if "(무)" in s:
                return {"bg": "6A1B9A", "fg": "FFFFFF", "bold": True}
            if "(핸무)" in s:
                return {"bg": "E65100", "fg": "FFFFFF", "bold": True}
            return {"bg": "7B1FA2", "fg": "FFFFFF"}
        if s == "핸승":
            return {"bg": "1565C0", "fg": "FFFFFF", "bold": True}
        return {"fg": "9E9E9E"}

    if group["kind"] == "ph" and sub == "실측":
        n = _num(value)
        if n is None:
            return {"fg": "9E9E9E"}
        if n >= 80:
            return {"bg": "1B5E20", "fg": "FFFFFF", "bold": True}
        if n >= 75:
            return {"bg": "2E7D32", "fg": "FFFFFF", "bold": True}
        if n >= 70:
            return {"bg": "66BB6A", "fg": "0D1B2A"}
        if n >= 65:
            return {"bg": "C5E1A5", "fg": "1B5E20"}
        return {"fg": "9E9E9E"}

    if group["kind"] == "ph" and sub in ("해)플핸", "국)플핸"):
        n = _num(value)
        if n is None:
            return None
        if n >= 85:
            return {"bg": "311B92", "fg": "FFFFFF", "bold": True}
        if n >= 80:
            return {"bg": "512DA8", "fg": "FFFFFF"}
        if n >= 75:
            return {"bg": "9575CD", "fg": "1A1A1A"}
        if n < 50:
            return {"bg": "1565C0", "fg": "FFFFFF", "bold": True}
        return None

    return None


def build_table_excel(columns, rows, title: str = "분석표") -> io.BytesIO:
    """
    현재 조회된 분석표를 화면과 같은 2단 헤더(그룹제목+세부라벨) + 색상으로 내보낸다.
    (RT/PICK/실측/플핸% 배지 색, 핸디 +/- 색은 화면의 columnGroups.js cellStyle 규칙 그대로)
    """
    groups = build_column_groups(columns or [])

    wb = Workbook()
    ws = wb.active
    ws.title = (title or "분석표")[:31]

    leaf_meta = []  # 시트 컬럼 순서와 1:1 대응하는 (group, col)
    col_idx = 1
    for g in groups:
        span = len(g["cols"])
        start, end = col_idx, col_idx + span - 1

        head = ws.cell(row=1, column=start, value=g["label1"])
        head.font = _GROUP_HEADER_FONT
        head.alignment = _CENTER
        for c in range(start, end + 1):
            ws.cell(row=1, column=c).fill = _GROUP_HEADER_FILL
        if end > start:
            ws.merge_cells(start_row=1, start_column=start, end_row=1, end_column=end)

        for i, col in enumerate(g["cols"]):
            sub_cell = ws.cell(row=2, column=start + i, value=col["sub"])
            sub_cell.font = _SUB_HEADER_FONT
            sub_cell.fill = _SUB_HEADER_FILL
            sub_cell.alignment = _CENTER
            leaf_meta.append((g, col))

        col_idx = end + 1

    for r_i, row in enumerate(rows or [], start=3):
        for c_i, (g, col) in enumerate(leaf_meta, start=1):
            value = row.get(col["key"])
            cell = ws.cell(row=r_i, column=c_i, value=_format_cell(g, col, value))
            style = _cell_style(g, col, value)
            if style:
                if "bg" in style:
                    cell.fill = PatternFill("solid", fgColor=style["bg"])
                cell.font = Font(bold=style.get("bold", False), color=style.get("fg"))

    ws.freeze_panes = "A3"
    for i, (g, col) in enumerate(leaf_meta, start=1):
        letter = get_column_letter(i)
        if col["sub"] in _SUB4:
            width = 7
        elif col["sub"] in ("DT",):
            width = 14
        elif col["sub"] in ("HT", "AT", "PICK"):
            width = 12
        else:
            width = 9
        ws.column_dimensions[letter].width = width

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf
