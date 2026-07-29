"""
엑셀 내보내기 모음.
  · build_match_excel()    상세보기 팝업 1경기를 한 시트로 (팝업과 같은 2단 배치)
  · build_upload_template() 경기 업로드용 빈 표본 양식
  · build_table_excel()    현재 조회된 분석표 그대로

모두 이미 계산·저장되어 있는 값을 옮겨 담을 뿐, 새로 계산하지 않는다.
"""
import io

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# 실제로 다 채운 한 경기 예시 — 작성안내 시트에 '이렇게 채우면 됩니다'로 보여준다.
# DT는 일부러 08/22 같은 실수하기 쉬운 형식이 아니라 정확한 형식(연도-월-일)으로 적어 둔다.
UPLOAD_EXAMPLE_ROW = {
    "L": "EP", "S": "25-26", "R": "1R", "No": 1, "DT": "2026-08-22", "TM": 1500,
    "HT": "아스널", "HS": 2, "RT": "핸승", "AS": 0, "AT": "첼시",
    "KW": 1.80, "KD": 3.50, "KL": 4.20, "KH": -1.0, "KHW": 2.10, "KHD": 3.60, "KHL": 1.80,
    "FW": 1.90, "FD": 3.60, "FL": 4.00, "FH": -1.0, "FHW": 2.00, "FHD": 3.50, "FHL": 1.85,
}

# 업로드 양식의 컬럼 — engine.preprocess_data()의 target_cols와 반드시 같아야 한다.
# (여기 순서대로 헤더를 만들어야 업로드 시 그대로 인식됨)
UPLOAD_TEMPLATE_COLS = [
    "L", "S", "R", "No", "DT", "TM", "HT", "HS", "RT", "AS", "AT",
    "KW", "KD", "KL", "KH", "KHW", "KHD", "KHL",
    "FW", "FD", "FL", "FH", "FHW", "FHD", "FHL",
]

# 경기입력 시트 맨 위에 놓는 한글 라벨(짧게). 이 줄은 영문 코드 헤더보다 위에 있어야 안전하다 —
# find_header_row()는 'DT'와 'HT'가 '같이 있는 줄'을 찾아 그걸 진짜 헤더로 삼으므로,
# 한글 라벨 줄이 코드 헤더 '위'에 있으면 자동으로 무시되고, '아래'에 있으면 데이터로 잘못 읽힌다.
UPLOAD_COL_KOREAN_LABEL = {
    "L": "리그", "S": "시즌", "R": "라운드", "No": "경기순서", "DT": "경기일", "TM": "경기시간",
    "HT": "홈팀", "HS": "홈팀점수", "RT": "결과", "AS": "원정팀 점수", "AT": "원정팀",
    "KW": "국)승", "KD": "국)무", "KL": "국)패", "KH": "국핸디",
    "KHW": "국)H-승", "KHD": "국)H-무", "KHL": "국)H-패",
    "FW": "해)승", "FD": "해)무", "FL": "해)패", "FH": "해핸디",
    "FHW": "해)H-승", "FHD": "해)H-무", "FHL": "해)H-패",
}

# 업로드 양식 각 컬럼의 뜻 — '작성안내' 시트 표에 함께 넣어 비개발자도 채울 수 있게 한다.
UPLOAD_COL_HINTS = {
    "L": "리그", "S": "시즌(예: 25-26)", "R": "라운드(예: 38R)", "No": "경기번호",
    "DT": "일자 (반드시 2026-08-22 처럼 '연도-월-일' 형식. 08/22처럼 연도 없이 적으면 인식 안 됨)",
    "TM": "시각", "HT": "홈팀(필수)", "HS": "홈 득점",
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
    ("TK-W", "국/통) 승"), ("TK-L", "국/통) 패"), ("TK-WL", "국/통) 승+패"), ("TK-WDL", "국/통) 승+무+패"),
    ("F-W", "해) 승"), ("F-L", "해) 패"), ("F-WL", "해) 승+패"), ("F-WDL", "해) 승+무+패"),
    ("F-W-HT", "해) 승=홈팀"), ("F-L-AT", "해) 패=원정팀"),
    ("TF-W", "해/통) 승"), ("TF-L", "해/통) 패"), ("TF-WL", "해/통) 승+패"), ("TF-WDL", "해/통) 승+무+패"),
]

_HEADER_FILL = PatternFill("solid", fgColor="1F2937")
_HEADER_FONT = Font(bold=True, color="FFFFFF")
_MAX_FILL = PatternFill("solid", fgColor="D4C97A")  # 표의 노란(khaki) 최댓값 강조와 동일 톤
_CENTER = Alignment(horizontal="center", vertical="center")
_THIN = Side(style="thin", color="D1D5DB")
_THICK = Side(style="medium", color="6B7280")
_BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
_DIVIDER_BORDER = Border(left=_THIN, right=_THIN, top=_THICK, bottom=_THIN)  # 화면의 굵은 구분선과 동일
_TITLE_FONT = Font(bold=True, size=14)
_BOLD = Font(bold=True)


def _with_right_divider(border):
    """기존 테두리는 유지한 채 오른쪽만 굵게 — 역/토탈 사이 세로 구분선용."""
    b = border or _BORDER
    return Border(left=b.left, right=_THICK, top=b.top, bottom=b.bottom)
_WINNER_FONT = Font(color="C62828", bold=True)  # 화면의 이긴 팀 점수 빨간 강조와 동일


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


def _form_or_dash(v):
    """폼(PPG) 값은 백엔드가 '2.13' 같은 문자열로 이미 반올림해 보내준다 — 그대로 쓴다."""
    return "-" if v is None or v == "" else str(v)


def _spaced_with_home_dot(results, venues):
    """results('WWDDL')와 venues('HAHAA', 같은 자리수의 H/A)를 같이 훑어서
    화면의 '점 = 홈경기' 표시를 엑셀에서는 그 글자 위에 결합 문자(U+0307, dot above)로 얹는다."""
    if not results:
        return "-"
    venues = venues or ""
    dot = "̇"   # COMBINING DOT ABOVE
    chars = []
    for i, ch in enumerate(results):
        chars.append(ch + dot if i < len(venues) and venues[i] == "H" else ch)
    return " ".join(chars)


def _int_or_blank(v):
    if v is None or v == "":
        return ""
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return v


def _points_for(m, reference_team):
    """HeadToHeadResult.jsx homePoints()와 동일 — 기준 팀이 홈/원정 상관없이 그 경기에서
    딴 승점(승3/무1/패0). 점수가 없으면(예정 경기) 빈 칸."""
    hs, as_ = m.get("HS"), m.get("AS")
    if hs is None or as_ is None or hs == "" or as_ == "":
        return ""
    try:
        hs, as_ = float(hs), float(as_)
    except (TypeError, ValueError):
        return ""
    if m.get("HT") == reference_team:
        mine, theirs = hs, as_
    elif m.get("AT") == reference_team:
        mine, theirs = as_, hs
    else:
        return ""
    if mine > theirs:
        return 3
    if mine < theirs:
        return 0
    return 1


_RIGHT_COL = 7  # 'G' — 팝업의 오른쪽 칼럼(상대전적)이 시작하는 위치


def build_match_excel(row: dict, h2h: dict) -> io.BytesIO:
    """
    MatchDetailModal.jsx의 2단 레이아웃(왼쪽: 배당·플핸예측·지표별표본 /
    오른쪽: 상대전적)을 그대로 옮긴다 — 왼쪽은 A열, 오른쪽은 G열에서 시작.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "상세보기"

    def write_row(values, row_idx, start_col=1, font=None, fill=None, align=None, border=None):
        for i, v in enumerate(values):
            cell = ws.cell(row=row_idx, column=start_col + i, value=v)
            cell.border = border or _BORDER
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
    _SAMPLE_YK_COL = 5  # 지표(1) 핸승(2) 핸무(3) 무(4) 역(5) 토탈(6)
    r = write_row(["지표", "핸승", "핸무", "무", "역", "토탈"], r, font=_HEADER_FONT,
                  fill=_HEADER_FILL, align=_CENTER)
    ws.cell(row=r - 1, column=_SAMPLE_YK_COL).border = _with_right_divider(_BORDER)
    grand = [0, 0, 0, 0]
    prev_code = None
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
        # 국내(K-/TK-) 지표 블록 → 해외(F-/TF-) 지표 블록 경계에 화면과 같은 굵은 선
        is_foreign = code.startswith("F-") or code.startswith("TF-")
        was_foreign = prev_code is not None and (prev_code.startswith("F-") or prev_code.startswith("TF-"))
        group_border = _DIVIDER_BORDER if (is_foreign and not was_foreign) else None
        r = write_row([label, *vals, sum(vals)], r, border=group_border)
        ws.cell(row=row_idx, column=_SAMPLE_YK_COL).border = _with_right_divider(group_border)
        prev_code = code
        vmax = max(vals)
        if vmax > 0:
            for i, v in enumerate(vals):
                if v == vmax:
                    ws.cell(row=row_idx, column=2 + i).fill = _MAX_FILL

    row_idx = r
    r = write_row(["토탈", *grand, sum(grand)], r, font=_BOLD)
    ws.cell(row=row_idx, column=_SAMPLE_YK_COL).border = _with_right_divider(_BORDER)
    vmax = max(grand)
    if vmax > 0:
        for i, v in enumerate(grand):
            if v == vmax:
                ws.cell(row=row_idx, column=2 + i).fill = _MAX_FILL

    # 토탈 바로 아래 줄에 각 결과의 비율 — 화면 팝업의 (18.3%) 표기와 같은 자리
    gsum = sum(grand)
    pct_idx = r
    r = write_row(["", *[f"({v / gsum * 100:.1f}%)" if gsum else "" for v in grand], ""], r)
    ws.cell(row=pct_idx, column=_SAMPLE_YK_COL).border = _with_right_divider(_BORDER)

    # ── 오른쪽(G열): 폼 지표 → 최근10경기 전적 → 상대전적 (화면 팝업과 같은 순서) ──
    rr = section_start
    ws.cell(row=rr, column=_RIGHT_COL, value="폼 지표").font = _BOLD
    rr += 1
    _FORM_DIV_COL = _RIGHT_COL + 2   # 홈 3칸 / 원정 3칸 경계
    form_head = rr
    rr = write_row(["홈", "", "", "원정", "", ""], rr, start_col=_RIGHT_COL,
                   font=_HEADER_FONT, fill=_HEADER_FILL, align=_CENTER)
    ws.merge_cells(start_row=form_head, start_column=_RIGHT_COL,
                   end_row=form_head, end_column=_RIGHT_COL + 2)
    ws.merge_cells(start_row=form_head, start_column=_RIGHT_COL + 3,
                   end_row=form_head, end_column=_RIGHT_COL + 5)
    ws.cell(row=form_head, column=_FORM_DIV_COL).border = _with_right_divider(_BORDER)
    for values in (
        ["전체폼", "최근5폼", "홈경기", "원정경기", "최근5폼", "전체폼"],
        [_form_or_dash(row.get(k)) for k in ("HTF", "HRF", "HF", "AF", "ARF", "ATF")],
    ):
        is_head = values[0] == "전체폼"
        line = rr
        rr = write_row(values, rr, start_col=_RIGHT_COL,
                       font=_HEADER_FONT if is_head else _BOLD,
                       fill=_HEADER_FILL if is_head else None, align=_CENTER)
        ws.cell(row=line, column=_FORM_DIV_COL).border = _with_right_divider(_BORDER)
    rr += 1

    ws.cell(row=rr, column=_RIGHT_COL, value="최근10경기 전적").font = _BOLD
    rr += 1
    head = rr
    rr = write_row(["홈팀최근 →", "", "", "← 원정팀 최근", "", ""], rr, start_col=_RIGHT_COL,
                   font=_HEADER_FONT, fill=_HEADER_FILL, align=_CENTER)
    ws.merge_cells(start_row=head, start_column=_RIGHT_COL,
                   end_row=head, end_column=_RIGHT_COL + 2)
    ws.merge_cells(start_row=head, start_column=_RIGHT_COL + 3,
                   end_row=head, end_column=_RIGHT_COL + 5)
    ws.cell(row=head, column=_FORM_DIV_COL).border = _with_right_divider(_BORDER)
    line = rr
    # 홈팀은 왼쪽이 과거·오른쪽이 최신, 원정팀은 그 반대 (백엔드가 이미 그 순서로 만들어 둔다).
    # 글자 위 결합점(dot above)은 화면의 '그 경기가 홈경기였다' 표시와 동일하다.
    rr = write_row([
        _spaced_with_home_dot(row.get("HR10"), row.get("HR10H")), "", "",
        _spaced_with_home_dot(row.get("AR10"), row.get("AR10H")), "", "",
    ], rr, start_col=_RIGHT_COL, font=_BOLD, align=_CENTER)
    ws.merge_cells(start_row=line, start_column=_RIGHT_COL,
                   end_row=line, end_column=_RIGHT_COL + 2)
    ws.merge_cells(start_row=line, start_column=_RIGHT_COL + 3,
                   end_row=line, end_column=_RIGHT_COL + 5)
    ws.cell(row=line, column=_FORM_DIV_COL).border = _with_right_divider(_BORDER)
    rr += 1
    ws.cell(row=rr, column=_RIGHT_COL, value="글자 위 점 = 그 팀 기준 홈경기")
    rr += 1

    ws.cell(row=rr, column=_RIGHT_COL, value="상대전적").font = _BOLD
    rr += 1
    ws.cell(row=rr, column=_RIGHT_COL, value="결과는 각 경기의 홈팀 기준입니다.")
    rr += 1
    summary = h2h.get("summary")
    if summary:
        _H2H_YK_COL = _RIGHT_COL + 3  # 핸승(+0) 핸무(+1) 무(+2) 역(+3) 토탈(+4)
        rr = write_row(["핸승", "핸무", "무", "역", "토탈"], rr, start_col=_RIGHT_COL,
                       font=_HEADER_FONT, fill=_HEADER_FILL, align=_CENTER)
        ws.cell(row=rr - 1, column=_H2H_YK_COL).border = _with_right_divider(_BORDER)
        summary_row = rr
        rr = write_row([summary["핸승"], summary["핸무"], summary["무"], summary["역"],
                        summary["총"]], rr, start_col=_RIGHT_COL)
        ws.cell(row=summary_row, column=_H2H_YK_COL).border = _with_right_divider(_BORDER)
        rr += 1
        rr = write_row(["시즌", "R", "HT", "HS", "AS", "AT", "결과", "승점"], rr, start_col=_RIGHT_COL,
                       font=_HEADER_FONT, fill=_HEADER_FILL, align=_CENTER)
        prev_season = None
        for m in h2h.get("matches", []):
            season = m.get("S")
            # 시즌이 바뀌는 경계마다 화면과 같은 굵은 구분선
            divider = prev_season is not None and season != prev_season
            hs_val = _int_or_blank(m.get("HS"))
            as_val = _int_or_blank(m.get("AS"))
            row_idx = rr
            rr = write_row([
                season, m.get("R"), m.get("HT"), hs_val, as_val, m.get("AT"),
                m.get("RT_label") or "", _points_for(m, ht),
            ], rr, start_col=_RIGHT_COL, border=_DIVIDER_BORDER if divider else None)
            # 이긴 팀 점수만 빨간 강조 (화면의 winner-score와 동일)
            if isinstance(hs_val, int) and isinstance(as_val, int):
                if hs_val > as_val:
                    ws.cell(row=row_idx, column=_RIGHT_COL + 3).font = _WINNER_FONT
                elif as_val > hs_val:
                    ws.cell(row=row_idx, column=_RIGHT_COL + 4).font = _WINNER_FONT
            prev_season = season
        total = h2h.get("total", 0)
        shown = len(h2h.get("matches", []))
        if total > shown:
            ws.cell(row=rr, column=_RIGHT_COL, value=f"최근 {shown}경기만 표시 (총 {total}경기)")
            rr += 1
        ws.cell(row=rr, column=_RIGHT_COL, value="승점은 홈팀 기준으로 작성되었습니다.")
        rr += 1
    else:
        ws.cell(row=rr, column=_RIGHT_COL, value=f"{ht} vs {at} 맞대결 기록 없음")
        rr += 1

    widths = {1: 18, 2: 12, 3: 12, 4: 12, 5: 12, 6: 10,
             7: 10, 8: 10, 9: 10, 10: 10, 11: 10, 12: 10, 13: 10, 14: 10}
    for col, width in widths.items():
        ws.column_dimensions[get_column_letter(col)].width = width

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


_KOREAN_LABEL_FONT = Font(bold=False, color="1A1A1A")


def build_upload_template(league_code: str = "", season: str = "", round_label: str = "",
                          match_count: int = 10) -> io.BytesIO:
    """
    경기 업로드용 빈 표본 양식.

    첫 시트('경기입력')는 2행 헤더 — 1행은 한글 라벨(리그/시즌/...), 2행은 실제
    인식되는 영문 코드(L/S/...)이고, 데이터는 3행부터 시작한다.
    한글 라벨을 영문 코드 '아래'에 넣으면(예전 방식) find_header_row()가 2행을
    헤더로 잡은 뒤 그 아래 한글 라벨 줄이 HT/AT가 채워진 경기 한 건으로 오인식되어
    쓰레기 데이터가 들어갔다. 한글 라벨을 코드 '위'에 두면 find_header_row()가
    'DT'+'HT'가 있는 2행을 정확히 헤더로 찾아내고, 그 위 1행은 자동으로 무시되어 안전하다.

    league_code(L)/season(S)/round_label(R)을 넘기면 경기번호(No) 1~match_count로
    행을 미리 만들어 그 세 컬럼을 채워 둔다 — 나머지 칸(HT/AT/배당 등)만 채우면 되게.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "경기입력"

    for i, col in enumerate(UPLOAD_TEMPLATE_COLS, start=1):
        label_cell = ws.cell(row=1, column=i, value=UPLOAD_COL_KOREAN_LABEL.get(col, col))
        label_cell.font = _KOREAN_LABEL_FONT
        label_cell.alignment = _CENTER
        label_cell.border = _BORDER
        if col == "DT":
            label_cell.comment = Comment(
                "일자는 반드시 연도-월-일 형식으로 적으세요.\n"
                "예: 2026-08-22\n"
                "08/22 처럼 연도 없이 적으면 인식되지 않습니다.",
                "BETPRO",
            )

        code_cell = ws.cell(row=2, column=i, value=col)
        code_cell.font = _HEADER_FONT
        code_cell.fill = _HEADER_FILL
        code_cell.alignment = _CENTER
        code_cell.border = _BORDER

        ws.column_dimensions[get_column_letter(i)].width = 14

    if league_code or season or round_label:
        prefill = {"L": league_code, "S": season, "R": round_label}
        for row_i in range(match_count):
            for col_i, col in enumerate(UPLOAD_TEMPLATE_COLS, start=1):
                if col == "No":
                    ws.cell(row=3 + row_i, column=col_i, value=row_i + 1)
                elif col in prefill and prefill[col]:
                    ws.cell(row=3 + row_i, column=col_i, value=prefill[col])

    ws.freeze_panes = "A3"

    guide = wb.create_sheet("작성안내")
    guide.cell(row=1, column=1, value="경기 데이터 작성 안내").font = _TITLE_FONT
    notes = [
        "'경기입력' 시트의 2행부터 한 줄에 한 경기씩 입력하세요.",
        "홈팀(HT)과 원정팀(AT)은 반드시 채워야 합니다. 비어 있으면 그 줄은 무시됩니다.",
        "결과(RT)는 핸승 / 핸무 / 무 / 역 중 하나로 적고, 아직 안 끝난 경기는 비워 두세요.",
        "이미 등록된 경기와 시즌·라운드·경기번호·팀이 모두 같으면 새로 올린 값으로 대체됩니다"
        " (예정 경기에 결과만 나중에 채우는 용도). 단, 그 경기의 26개 지표·플핸예측은 처음"
        " 등록됐을 때 값을 그대로 유지하며 다시 계산되지 않습니다.",
        "컬럼 순서를 바꾸거나 컬럼명을 고치지 마세요.",
        "일자(DT)는 반드시 '연도-월-일' 형식으로 적으세요. 예: 2026-08-22"
        " (08/22처럼 연도 없이 적으면 인식되지 않습니다.)",
    ]
    r = 3
    for n in notes:
        guide.cell(row=r, column=1, value=f"· {n}")
        r += 1
    r += 2

    guide.cell(row=r, column=1, value="입력 예시 (한 경기를 다 채우면 이런 모습)").font = _BOLD
    r += 1
    for col_i, col in enumerate(UPLOAD_TEMPLATE_COLS, start=1):
        c = guide.cell(row=r, column=col_i, value=col)
        c.font = _HEADER_FONT
        c.fill = _HEADER_FILL
        c.alignment = _CENTER
    r += 1
    for col_i, col in enumerate(UPLOAD_TEMPLATE_COLS, start=1):
        guide.cell(row=r, column=col_i, value=UPLOAD_EXAMPLE_ROW.get(col))
    r += 2

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
# 경기 직전 시즌 성적: HP/AP=순위, HTF/ATF=전체경기 PPG, HF/AF=홈·원정경기 PPG
_MATCH_COLS = ["HTF", "HF", "HP", "HT", "HS", "RT", "AS", "AT", "AP", "AF", "ATF"]
_K_ODDS_COLS = ["KW", "KD", "KL", "KH", "KHW", "KHD", "KHL"]
_F_ODDS_COLS = ["FW", "FD", "FL", "FH", "FHW", "FHD", "FHL"]
_PH_COLS = [
    ("PH_STATUS", "적중"),
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
        if sub in ("PICK", "적중"):
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

    if group["kind"] == "ph" and sub == "적중":
        s = "" if _blank(value) else str(value).strip()
        return {
            "적중": {"bg": "FDD835", "fg": "0D1B2A", "bold": True},
            "미적": {"bg": "C62828", "fg": "FFFFFF", "bold": True},
            "관망": {"bg": "757575", "fg": "FFFFFF", "bold": True},
        }.get(s)

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
