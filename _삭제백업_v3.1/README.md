# v3.1에서 지운 코드 백업

2026-09-26, 버전을 3.0 → 3.1로 올리면서 **아무 데서도 쓰이지 않던 코드**를 지웠습니다.
이 폴더는 프로그램 동작과 상관없어서, 필요 없다고 판단되면 폴더째 지우셔도 됩니다.
되살리려면 해당 내용을 원래 파일에 다시 붙이면 됩니다(git 이력에도 남아 있습니다).

| 파일 | 내용 |
|---|---|
| `combo_dir.py.txt` | `api/combo_dir.py` 통째 — 조합 방향 색인. 어디서도 import 되지 않음 |
| `removed_functions.py.txt` | 함수 4개: `archive.get_tag` · `cup_matches.team_ids_for` · `cup_matches.matches_around` · `my_picks.migrate_sample_note_direction`(1회성 이전 작업, 이미 실행됨) |
| `removed_css.css.txt` | 화면 코드에서 안 쓰는 CSS 규칙 46개(대부분 예전 '픽 판정 카드' 스타일) |

## 일부러 남긴 것
- `web/src/utils/expectedScore.js`(예상점수)·`systemVerdict.js`의 `systemGrade` — 지금은 안 불리지만 다시 켤 수 있게 보관한다고 적어 둔 것들이라 그대로 뒀습니다.
- `betpro_paths.py`의 안 쓰는 함수 5개 — CLAUDE.md가 "그대로 유지"하라고 한 파일이라 손대지 않았습니다.
